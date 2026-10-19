import { BUILTIN_COMMANDS, githubNoreply, parseRepoCommand, type CodeDiffDTO, type CodePrDraftDTO, type CodePullDTO, type SlashCommand } from '@sixfinger/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import type { AuthUser } from '../lib/types.ts';
import type { AiProvider } from './ai.ts';
import type { Code } from './code.ts';
import type { Github } from './github.ts';
import type { RunHub } from './runs.ts';
import { discoverRepoSkills, type Catalog, type Skills } from './skills.ts';
import { ToolError } from './tools/errors.ts';
import { getPath } from './chats.ts';
import { FileNotFoundError, IsDirectoryError, NotPreparedError, type CodeSandboxClient, type CodeScope, type SandboxHttpRequest } from './tools/code-client.ts';
import { mimeOf } from '../lib/mime.ts';

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const MAX_DIFF_CHARS = 300_000;
const BASE = '"$(cat .git/sixfinger/base)"';

export interface CodeGitDeps {
  db: Db;
  ai: AiProvider;
  code: Code;
  github: Github;
  sandbox: CodeSandboxClient | null;
  runs: RunHub;
  config: Config;
  skills: Skills;
}

const PR_SYSTEM = [
  'You write GitHub pull request titles and descriptions for code changes made by a coding agent.',
  'Output format, nothing else: the FIRST line is the title (at most 72 characters, imperative mood, no trailing period, no prefix like "Title:").',
  'Then a blank line, then a short Markdown description: a "## Summary" with 2-5 bullets of what changed and why, and a "## Testing" section only if the commits or the request show what was run or verified.',
  'Do not invent changes that are not in the commit list. Do not mention the AI or tools.',
].join(' ');

/** Code oturumunun GitHub tarafı: PR taslağı, push, PR açma ve birleşik fark. */
export function createCodeGit(deps: CodeGitDeps) {
  const { db, ai, code, github, runs, config } = deps;

  async function load(user: Pick<AuthUser, 'id'>, chatId: string) {
    const session = await code.getSession(user.id, chatId);
    if (!session) throw notFound('Oturum bulunamadı.');
    if (!deps.sandbox) throw new HttpError(503, 'upstream_unavailable', 'Code sandbox bu sunucuda yapılandırılmamış.');
    const scope: CodeScope = { user: user.id, session: `${user.id}:${chatId}` };
    return { session, scope, sandbox: deps.sandbox, running: runs.activeChatIds().includes(chatId) };
  }

  async function connection(userId: string) {
    const gh = await code.getConnection(userId);
    if (!gh) throw new HttpError(409, 'github_required', 'GitHub bağlantın yok ya da geçersiz. Hesabını yeniden bağla.');
    return gh;
  }

  /** sandboxd yeniden başlamışsa çalışma alanını hazırlayıp işi bir kez daha dener. */
  async function withWorkspace<T>(user: Pick<AuthUser, 'id'>, chatId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof NotPreparedError)) throw err;
    }
    const { session, scope, sandbox } = await load(user, chatId);
    const gh = await connection(user.id);
    const env = session.environmentId ? await code.getEnvironment(user.id, session.environmentId).catch(() => null) : null;
    await sandbox.prepare(
      {
        ...scope, repo: session.repo, baseBranch: session.baseBranch, workBranch: session.workBranch, token: gh.token,
        author: { name: gh.login, email: githubNoreply(gh.githubId, gh.login) },
        network: { mode: env?.network ?? 'trusted', domains: env?.allowedDomains ?? [] }, diskMb: env?.diskMb ?? 512,
        setupScript: env?.setupScript ?? '', env: env?.envVars ?? {},
      },
      AbortSignal.timeout(20 * 60_000),
    );
    return fn();
  }

  const guardIdle = (running: boolean) => {
    if (running) throw new HttpError(409, 'conflict', 'Ajan çalışırken GitHub\'a gönderemezsin. Önce turun bitmesini bekle ya da durdur.');
  };

  /** `internal`: ajanın kendi turunun sonunda çağrılır (tur hâlâ "çalışıyor" görünür; kullanıcı isteğinde bu engellenir). */
  async function push(user: AuthUser, chatId: string, opts: { internal?: boolean } = {}): Promise<{ sha: string; branch: string }> {
    const { session, scope, sandbox, running } = await load(user, chatId);
    if (!opts.internal) guardIdle(running);
    const gh = await connection(user.id);
    const out = await withWorkspace(user, chatId, () => sandbox.push(scope, gh.token, AbortSignal.timeout(5 * 60_000), { force: session.forcePush })).catch((err) => {
      if (err instanceof ToolError) throw new HttpError(502, 'upstream_unavailable', err.message);
      throw err;
    });
    await code.setPushedSha(chatId, out.sha);
    if (session.forcePush) await code.setForcePush(chatId, false);
    return { sha: out.sha, branch: out.branch };
  }

  async function exec(user: AuthUser, chatId: string, command: string, timeoutS = 30): Promise<string> {
    const { scope, sandbox } = await load(user, chatId);
    const r = await withWorkspace(user, chatId, () => sandbox.exec(scope, command, timeoutS, AbortSignal.timeout((timeoutS + 30) * 1000)));
    return r.stdout;
  }

  async function draft(user: AuthUser, chatId: string, summary = ''): Promise<CodePrDraftDTO> {
    const { session, running } = await load(user, chatId);
    const idle = !running || summary !== '';
    let subjects: string[] = [];
    let stat = '';
    if (idle) {
      const out = await exec(user, chatId, `git add -A -- . >/dev/null 2>&1; git log --reverse --format='%s' ${BASE}..HEAD | head -n 40; echo '---STAT---'; git diff --cached --stat=100 ${BASE} | tail -n 40`).catch(() => '');
      const [log = '', st = ''] = out.split('---STAT---');
      subjects = log.split('\n').map((l) => l.trim()).filter(Boolean);
      stat = st.trim();
    }
    const first = await db.query<{ content: string }>(`select content from messages where chat_id = $1 and role = 'user' order by seq asc limit 1`, [chatId]);
    const request = first.rows[0]?.content.slice(0, 1_500) ?? '';
    const fallbackTitle = (subjects[0] ?? (session.title === 'Yeni oturum' ? `${session.repo.split('/')[1]} değişiklikleri` : session.title)).slice(0, 100);
    let title = fallbackTitle;
    let body = subjects.length ? `## Summary\n${subjects.map((s) => `- ${s}`).join('\n')}` : '';
    if (subjects.length) {
      try {
        const raw = await ai.complete({
          messages: [
            { role: 'system', content: PR_SYSTEM },
            { role: 'user', content: `Language: ${user.locale === 'tr' ? 'Turkish' : 'English'}\nRepository: ${session.repo}\nBase branch: ${session.baseBranch}\nUser request:\n${request}\n\nThe agent's final report:\n${summary.slice(0, 2_000)}\n\nCommits:\n${subjects.map((s) => `- ${s}`).join('\n')}\n\nDiff stat:\n${stat}` },
          ],
          route: 'code', mode: 'deep', effort: 'low', temperature: 0.3, maxTokens: 900,
        });
        const lines = raw.trim().split('\n');
        const t = (lines.shift() ?? '').replace(/^[#*\s]+|^title:\s*/gi, '').replace(/^["'`]+|["'`]+$/g, '').replace(/[.。]+$/, '').trim();
        const b = lines.join('\n').trim();
        if (t) title = t.slice(0, 100);
        if (b) body = b.slice(0, 8_000);
      } catch {
        /* model yoksa commit başlıklarıyla devam */
      }
    }
    const env = session.environmentId ? await code.getEnvironment(user.id, session.environmentId).catch(() => null) : null;
    const link = env?.commitSessionLink ? `\n[SixFinger Code oturumu](${config.PUBLIC_WEB_URL.replace(/\/$/, '')}/code/s/${chatId})` : '';
    body = `${body}\n\n---\n*Created with SixFinger Code*${link}`.trim();
    return {
      title,
      body,
      base: session.baseBranch,
      head: session.workBranch,
      commits: subjects.length,
      additions: session.additions,
      deletions: session.deletions,
      files: session.filesChanged,
      needsPush: Boolean(session.headSha) && session.headSha !== session.pushedSha,
    };
  }

  /**
   * Ajanın PR işi: commit'i GitHub'a iter; oturumun PR'ı yoksa (model yazımı başlık/açıklamayla) açar, varsa o PR kendiliğinden güncellenir.
   * `internal`: tur sonunda ajanın kendisi çağırır. Kullanıcı yeniden denerken (başlık/açıklama vermeden ya da vererek) aynı yol kullanılır.
   */
  async function publish(
    user: AuthUser,
    chatId: string,
    opts: { internal?: boolean; summary?: string; title?: string; body?: string; draft?: boolean } = {},
  ): Promise<{ pull: CodePullDTO | null; created: boolean; existed: boolean; sha: string }> {
    const { session, running } = await load(user, chatId);
    if (!opts.internal) guardIdle(running);
    if (!session.headSha) throw new HttpError(409, 'conflict', 'Henüz commit yok; PR açılacak bir değişiklik bulunmuyor.');
    const gh = await connection(user.id);
    const pushed = await push(user, chatId, { internal: opts.internal });
    if (session.prUrl && session.prNumber) {
      return { pull: null, created: false, existed: true, sha: pushed.sha };
    }
    const d = opts.title ? null : await draft(user, chatId, opts.summary ?? '');
    const r = await github.createPull(gh.token, session.repo, {
      title: opts.title ?? d!.title,
      body: opts.body ?? d!.body,
      head: session.workBranch,
      base: session.baseBranch,
      draft: opts.draft ?? false,
    });
    await code.setSessionPr(chatId, r.pull.number, r.pull.url);
    return { pull: r.pull, created: !r.existed, existed: r.existed, sha: pushed.sha };
  }

  async function diff(user: AuthUser, chatId: string, path?: string): Promise<CodeDiffDTO> {
    const { running } = await load(user, chatId);
    if (running) return { diff: '', truncated: false, stale: true };
    try {
      const target = path ? ` -- ${shq(path)}` : '';
      const out = await exec(user, chatId, `git add -A -- . >/dev/null 2>&1; git diff --cached --no-color --no-ext-diff --no-textconv -U3 ${BASE}${target} | head -c ${MAX_DIFF_CHARS + 1}`, 60);
      return { diff: out.slice(0, MAX_DIFF_CHARS), truncated: out.length > MAX_DIFF_CHARS, stale: false };
    } catch {
      return { diff: '', truncated: false, stale: true };
    }
  }

  /** Repodaki slash komutları (`.claude/commands/*.md`, `.sixfinger/commands/*.md`). Okunamazsa boş liste. */
  async function commands(user: AuthUser, chatId: string): Promise<SlashCommand[]> {
    const { running } = await load(user, chatId);
    if (running) return [];
    try {
      const out = await exec(user, chatId, `for f in .claude/commands/*.md .sixfinger/commands/*.md; do [ -f "$f" ] || continue; echo "@@FILE $f"; head -c 6000 "$f"; echo; done`, 20);
      const seen = new Set<string>();
      const list: SlashCommand[] = [];
      for (const chunk of out.split('@@FILE ').slice(1)) {
        const nl = chunk.indexOf('\n');
        const cmd = parseRepoCommand(chunk.slice(0, nl).trim(), chunk.slice(nl + 1));
        if (cmd && !seen.has(cmd.name)) {
          seen.add(cmd.name);
          list.push(cmd);
        }
      }
      const repoCmds = list.slice(0, 40);
      const taken = new Set([...BUILTIN_COMMANDS.map((c) => c.name), ...repoCmds.map((c) => c.name)]);
      const cat = await skillCatalog(user, chatId, true).catch(() => null);
      const skillCmds: SlashCommand[] = (cat?.list ?? [])
        .filter((s) => !taken.has(s.name))
        .map((s) => ({ name: s.name, kind: 'send', source: 'skill', description: s.description.slice(0, 160), template: `Use the "${s.name}" skill (call the skill tool first and follow it) for this task: $ARGUMENTS` }));
      return [...repoCmds, ...skillCmds];
    } catch {
      return [];
    }
  }

  /** Oturumun skill kataloğu: yerleşik + kullanıcı (+ `repo` ise çalışma alanından keşfedilen) − ortamda kapatılanlar. */
  async function skillCatalog(user: Who, chatId: string, repo: boolean): Promise<Catalog> {
    const { session, scope, sandbox } = await load(user, chatId);
    const env = session.environmentId ? await code.getEnvironment(user.id, session.environmentId).catch(() => null) : null;
    const found = repo ? await withWorkspace(user, chatId, () => discoverRepoSkills(sandbox, scope, AbortSignal.timeout(30_000))).catch(() => []) : [];
    return deps.skills.catalog(user.id, env?.skillsOff ?? [], found);
  }

  /** Çalışma alanındaki dosyalar (izlenen + yeni, .gitignore hariç); `q` verilirse yola göre süzülür (@dosya ve dosya gezgini için). */
  async function files(user: AuthUser, chatId: string, q = ''): Promise<{ files: string[]; truncated: boolean }> {
    const { running } = await load(user, chatId);
    if (running) return { files: [], truncated: false };
    const limit = q ? 40 : 3_000;
    const filter = q ? ` | grep -i -F -- ${shq(q)}` : '';
    try {
      const out = await exec(user, chatId, `git ls-files -co --exclude-standard${filter} | head -n ${limit + 1}`, 30);
      const list = out.split('\n').map((l) => l.trim()).filter(Boolean);
      return { files: list.slice(0, limit), truncated: list.length > limit };
    } catch {
      return { files: [], truncated: false };
    }
  }

  /** Tek dosyanın içeriği (dosya gezgini). İkili/çok büyük dosyalar sandboxd'de reddedilir. */
  async function readFile(user: AuthUser, chatId: string, path: string): Promise<{ path: string; content: string; truncated: boolean }> {
    const { scope, sandbox } = await load(user, chatId);
    try {
      const r = await withWorkspace(user, chatId, () => sandbox.read(scope, path, AbortSignal.timeout(40_000)));
      return { path, content: r.content, truncated: r.truncated };
    } catch (err) {
      if (err instanceof FileNotFoundError) throw notFound('Dosya bulunamadı.');
      if (err instanceof IsDirectoryError) throw new HttpError(400, 'bad_request', 'Bu bir klasör.');
      if (err instanceof ToolError) throw new HttpError(400, 'bad_request', err.message);
      throw err;
    }
  }

  /** Çalışma alanını tar.gz olarak indirir (node_modules ve .git hariç). */
  async function archive(user: AuthUser, chatId: string): Promise<{ filename: string; data: Buffer }> {
    const { session, scope, sandbox, running } = await load(user, chatId);
    if (running) throw new HttpError(409, 'conflict', 'Ajan çalışırken arşiv alınamaz; turun bitmesini bekle.');
    try {
      const data = await withWorkspace(user, chatId, () => sandbox.archive(scope, AbortSignal.timeout(3 * 60_000)));
      return { filename: `${session.repo.split('/')[1] ?? 'workspace'}.tar.gz`, data };
    } catch (err) {
      if (err instanceof ToolError) throw new HttpError(400, 'bad_request', err.message);
      throw err;
    }
  }

  /**
   * Çalışma alanını ve sohbeti seçilen asistan mesajının sonuna geri sarar (checkpoint): çalışma alanı o ana kadarki son commit'e
   * sıfırlanır (izlenen/yeni dosyalar; .gitignore'daki node_modules korunur) ve sohbetin ucu o mesaja çekilir. Sonraki mesajlar
   * ayrı bir dal olarak kalır. Uzak branch ileride kalırsa bir sonraki push zorla yapılır (branch Code'a aittir).
   */
  async function rewind(user: AuthUser, chatId: string, messageId: string): Promise<{ sha: string }> {
    const { session, scope, sandbox, running } = await load(user, chatId);
    guardIdle(running);
    const own = await db.query<{ id: string; role: string }>('select id, role from messages where id = $1 and chat_id = $2', [messageId, chatId]);
    if (!own.rows[0] || own.rows[0].role !== 'assistant') throw notFound('Mesaj bulunamadı.');
    // Yoldaki son commit (yoksa oturumun başlangıç commit'i).
    let sha = '';
    for (const m of await getPath(db, messageId)) {
      for (const p of m.parts ?? []) if (p.type === 'tool' && p.name === 'commit' && typeof p.meta?.sha === 'string') sha = p.meta.sha;
    }
    const target = /^[0-9a-f]{40}$/.test(sha) ? shq(sha) : BASE;
    const out = await exec(user, chatId, `git reset -q --hard ${target} && git clean -qfd && git rev-parse HEAD`, 90);
    const head = out.trim().split('\n').at(-1) ?? '';
    if (!/^[0-9a-f]{40}$/.test(head)) throw new HttpError(502, 'upstream_unavailable', 'Çalışma alanı geri sarılamadı.');
    await db.query('update chats set leaf_id = $2, updated_at = now() where id = $1', [chatId, messageId]);
    if (session.pushedSha && session.pushedSha !== head) await code.setForcePush(chatId, true);
    try {
      const ch = await sandbox.changes(scope, AbortSignal.timeout(60_000));
      await code.updateSessionStats(chatId, { additions: ch.additions, deletions: ch.deletions, filesChanged: ch.files.length, headSha: head });
    } catch {
      /* sayılar bir sonraki turda tazelenir */
    }
    await db.query('update code_sessions set head_sha = $2 where chat_id = $1', [chatId, head]);
    return { sha: head };
  }


  // ---- önizleme, indirme, yükleme (ham sandbox işlemleri; hata sınıfları çağırana geçer) ----
  type Who = Pick<AuthUser, 'id'>;

  /** Çalışma alanındaki dosyanın ham baytları. Hata: FileNotFoundError / IsDirectoryError / ToolError. */
  async function sandboxFile(user: Who, chatId: string, path: string, maxMb: number): Promise<Buffer> {
    const { scope, sandbox } = await load(user, chatId);
    return withWorkspace(user, chatId, () => sandbox.raw(scope, path, maxMb, AbortSignal.timeout(90_000)));
  }
  async function sandboxPorts(user: Who, chatId: string): Promise<number[]> {
    const { scope, sandbox } = await load(user, chatId);
    return withWorkspace(user, chatId, () => sandbox.ports(scope, AbortSignal.timeout(20_000)));
  }
  async function sandboxHttp(user: Who, chatId: string, r: SandboxHttpRequest) {
    const { scope, sandbox } = await load(user, chatId);
    return withWorkspace(user, chatId, () => sandbox.http(scope, r, AbortSignal.timeout(45_000)));
  }

  /** İndirme (kullanıcıya dosya verme). Sınır: sandboxd'nin arşiv sınırı. */
  async function download(user: AuthUser, chatId: string, path: string): Promise<{ name: string; type: string; data: Buffer }> {
    try {
      const data = await sandboxFile(user, chatId, path, 64);
      const name = path.split('/').filter(Boolean).pop() ?? 'file';
      return { name, type: mimeOf(name), data };
    } catch (err) {
      if (err instanceof FileNotFoundError) throw notFound('Dosya bulunamadı.');
      if (err instanceof IsDirectoryError) throw new HttpError(400, 'bad_request', 'Bu bir klasör; dosya seç.');
      if (err instanceof ToolError) throw new HttpError(400, 'bad_request', err.message);
      throw err;
    }
  }

  /** Kullanıcının yüklediği dosya: `.sixfinger/uploads/<ad>` (git'e girmez). */
  async function upload(user: AuthUser, chatId: string, rawName: string, data: Buffer): Promise<{ path: string; name: string; bytes: number }> {
    const name = rawName.split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '').trim().slice(0, 100) || 'dosya';
    const path = `.sixfinger/uploads/${name}`;
    const { scope, sandbox } = await load(user, chatId);
    try {
      await withWorkspace(user, chatId, async () => {
        await sandbox.exec(scope, "mkdir -p .git/info && for p in .sixfinger/uploads/ .sixfinger/run/; do grep -qxF \"$p\" .git/info/exclude 2>/dev/null || echo \"$p\" >> .git/info/exclude; done", 15, AbortSignal.timeout(30_000));
        return sandbox.upload(scope, path, data, AbortSignal.timeout(60_000));
      });
    } catch (err) {
      if (err instanceof ToolError) throw new HttpError(400, 'bad_request', err.message);
      throw err;
    }
    return { path, name, bytes: data.length };
  }

  return { push, draft, publish, diff, commands, files, readFile, archive, rewind, sandboxFile, sandboxPorts, sandboxHttp, download, upload, skillCatalog };
}
export type CodeGit = ReturnType<typeof createCodeGit>;
