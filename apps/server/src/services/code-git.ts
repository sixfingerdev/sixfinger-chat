import { githubNoreply, type CodeDiffDTO, type CodePrDraftDTO, type CodePullDTO } from '@sixfinger/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import type { AuthUser } from '../lib/types.ts';
import type { AiProvider } from './ai.ts';
import type { Code } from './code.ts';
import type { Github } from './github.ts';
import type { RunHub } from './runs.ts';
import { ToolError } from './tools/errors.ts';
import { NotPreparedError, type CodeSandboxClient, type CodeScope } from './tools/code-client.ts';

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

  async function load(user: AuthUser, chatId: string) {
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
  async function withWorkspace<T>(user: AuthUser, chatId: string, fn: () => Promise<T>): Promise<T> {
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

  async function push(user: AuthUser, chatId: string): Promise<{ sha: string; branch: string }> {
    const { session, scope, sandbox, running } = await load(user, chatId);
    guardIdle(running);
    const gh = await connection(user.id);
    const out = await withWorkspace(user, chatId, () => sandbox.push(scope, gh.token, AbortSignal.timeout(5 * 60_000))).catch((err) => {
      if (err instanceof ToolError) throw new HttpError(502, 'upstream_unavailable', err.message);
      throw err;
    });
    await code.setPushedSha(chatId, out.sha);
    void session;
    return { sha: out.sha, branch: out.branch };
  }

  async function exec(user: AuthUser, chatId: string, command: string, timeoutS = 30): Promise<string> {
    const { scope, sandbox } = await load(user, chatId);
    const r = await withWorkspace(user, chatId, () => sandbox.exec(scope, command, timeoutS, AbortSignal.timeout((timeoutS + 30) * 1000)));
    return r.stdout;
  }

  async function draft(user: AuthUser, chatId: string): Promise<CodePrDraftDTO> {
    const { session, running } = await load(user, chatId);
    let subjects: string[] = [];
    let stat = '';
    if (!running) {
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
            { role: 'user', content: `Language: ${user.locale === 'tr' ? 'Turkish' : 'English'}\nRepository: ${session.repo}\nBase branch: ${session.baseBranch}\nUser request:\n${request}\n\nCommits:\n${subjects.map((s) => `- ${s}`).join('\n')}\n\nDiff stat:\n${stat}` },
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

  async function createPr(user: AuthUser, chatId: string, input: { title: string; body: string; draft: boolean }): Promise<{ pull: CodePullDTO; existed: boolean; sha: string }> {
    const { session, running } = await load(user, chatId);
    guardIdle(running);
    if (!session.headSha) throw new HttpError(409, 'conflict', 'Henüz commit yok; PR açılacak bir değişiklik bulunmuyor.');
    const gh = await connection(user.id);
    const pushed = await push(user, chatId);
    const r = await github.createPull(gh.token, session.repo, { title: input.title, body: input.body, head: session.workBranch, base: session.baseBranch, draft: input.draft });
    return { ...r, sha: pushed.sha };
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

  return { push, draft, createPr, diff };
}
export type CodeGit = ReturnType<typeof createCodeGit>;
