import { createHash } from 'node:crypto';
import {
  buildCommitMessage,
  commitSubject,
  creditsFor,
  githubNoreply,
  weightedTokens,
  type CodeEnvironmentDTO,
  type MessageDTO,
  type MessagePartDTO,
  type StreamEvent,
} from '@sixfinger/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { HttpError } from '../lib/errors.ts';
import type { AuthUser } from '../lib/types.ts';
import type { AiMessage, AiProvider, AiToolCall } from './ai.ts';
import { MESSAGE_COLUMNS, toMessageDTO, type ChatRow, type MessageRow } from './chats.ts';
import type { Code } from './code.ts';
import { messagesTokens, pruneToolResults } from './code-context.ts';
import { buildCodeSystemPrompt, commitMessagePrompt, WORKSPACE_BRIEF_COMMAND } from './code-prompt.ts';
import type { CodeQueue } from './code-queue.ts';
import { cleanTitle, fallbackTitle, fitHistory, titlePrompt, type HistoryItem } from './prompt.ts';
import type { Run } from './runs.ts';
import { runToolCall, toolSpecs, type Tools } from './tools/index.ts';
import type { CodeSandboxClient, CodeScope } from './tools/code-client.ts';

type Logger = { warn: (o: object, m: string) => void; error: (o: object, m: string) => void; info?: (o: object, m: string) => void };

export interface CodeRunDeps {
  db: Db;
  ai: AiProvider;
  tools: Tools;
  sandbox: CodeSandboxClient | null;
  code: Code;
  queue: CodeQueue;
  config: Config;
  log: Logger;
}

export interface CodeRunInput {
  chat: ChatRow;
  user: AuthUser;
  userMessage: MessageDTO | null;
  assistantId: string;
  /** Modele gidecek geçmiş (son eleman kullanıcı mesajı). */
  history: HistoryItem[];
  userText: string;
  isFirstExchange: boolean;
}

/** Aynı araç + aynı argüman + aynı çıktı bu kadar kez gelirse uyarılır / durdurulur. */
const LOOP_WARN = 3;
const LOOP_STOP = 5;
const MAX_CALLS_PER_STEP = 8;
const MAX_LENGTH_RETRIES = 2;
const SPEC_TOKENS_GUESS = 1_800;
const estimate = (s: string) => Math.ceil(s.length / 3.5);

const notes = (locale: 'tr' | 'en') =>
  locale === 'tr'
    ? {
        credits: '*Günlük Code kredin bitti, çalışma burada durdu. Kredin yenilenince “devam et” yazabilirsin.*',
        loop: '*Aynı adımları tekrarlayıp ilerleyemediğim için durdum. İsteğini biraz daha açık yazarsan devam edebilirim.*',
        context: '*Konuşma bağlamı doldu. Değişiklikler commit edildi; yeni bir oturum açıp kaldığın yerden sürdürebilirsin.*',
        length: '*Yanıt uzunluk sınırına takıldığı için durdum. “Devam et” yazarak sürdürebilirsin.*',
      }
    : {
        credits: '*Your daily Code credit ran out, so I stopped here. Type “continue” once it renews.*',
        loop: '*I stopped because I kept repeating the same steps without progress. Describe what you want a bit more precisely and I can carry on.*',
        context: '*The conversation context is full. Your changes are committed; start a new session to carry on from here.*',
        length: '*I stopped at the output length limit. Type “continue” to carry on.*',
      };

/** Asistan mesajının parçalarını ve anlık görüntüsünü tutar; 2 sn'de bir veritabanına yazar. */
class Buffer_ {
  parts: MessagePartDTO[] = [];
  content = '';
  reasoning = '';
  reasoningMs: number | null = null;
  private rStart = 0;
  private partStart = 0;
  private lastPersist = Date.now();

  constructor(
    private readonly db: Db,
    private readonly id: string,
    readonly base: MessageDTO,
  ) {}

  snapshot(): MessageDTO {
    return { ...this.base, content: this.content, reasoning: this.reasoning, reasoningMs: this.reasoningMs, status: 'streaming', parts: JSON.parse(JSON.stringify(this.parts)) };
  }

  closeReasoning(): void {
    const last = this.parts[this.parts.length - 1];
    if (last?.type === 'reasoning' && last.ms === null) last.ms = Date.now() - this.partStart;
    if (this.rStart && this.reasoningMs === null) this.reasoningMs = Date.now() - this.rStart;
  }

  addReasoning(t: string): void {
    if (!this.rStart) this.rStart = Date.now();
    this.reasoning += t;
    const last = this.parts[this.parts.length - 1];
    if (last?.type === 'reasoning') last.text += t;
    else {
      this.parts.push({ type: 'reasoning', text: t, ms: null });
      this.partStart = Date.now();
    }
    this.persist();
  }

  addText(t: string): void {
    this.closeReasoning();
    this.content += t;
    const last = this.parts[this.parts.length - 1];
    if (last?.type === 'text') last.text += t;
    else this.parts.push({ type: 'text', text: t });
    this.persist();
  }

  addTool(part: Extract<MessagePartDTO, { type: 'tool' }>): void {
    this.closeReasoning();
    this.parts.push(part);
  }

  persist(force = false): void {
    if (!force && Date.now() - this.lastPersist < 2_000) return;
    this.lastPersist = Date.now();
    this.db
      .query(`update messages set content = $2, reasoning = $3, parts = $4 where id = $1 and status = 'streaming'`, [this.id, this.content, this.reasoning, JSON.stringify(this.parts)])
      .catch(() => {});
  }
}

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const stable = (o: unknown): string => JSON.stringify(o, Object.keys((o as object) ?? {}).sort());

/** Bir Code oturumunda kullanıcı mesajına karşılık ajan döngüsünü çalıştırır. */
export async function runCodeGeneration(deps: CodeRunDeps, run: Run, g: CodeRunInput): Promise<void> {
  const { db, ai, code, config, log } = deps;
  const { chat, user } = g;
  const send = (e: StreamEvent) => run.emit(e);
  const signal = run.signal;
  const t = notes(user.locale);

  const row = await db.query<MessageRow>(`select ${MESSAGE_COLUMNS} from messages where id = $1`, [g.assistantId]);
  const buf = new Buffer_(db, g.assistantId, toMessageDTO(row.rows[0]!));
  run.snapshot = () => buf.snapshot();
  send({ type: 'start', userMessage: g.userMessage, assistantMessage: toMessageDTO(row.rows[0]!) });

  let status: MessageDTO['status'] = 'complete';
  let errorMessage: { code: HttpError['code']; message: string } | null = null;
  let provider = 'qwen';
  let stopNote = '';
  let release: (() => void) | undefined;
  let runStatus: 'idle' | 'error' = 'idle';
  const scope: CodeScope = { user: user.id, session: `${user.id}:${chat.id}` };
  let sandboxMs = 0;
  let diskUsedMb = 0;
  let contextTokens = 0;
  let env: Pick<CodeEnvironmentDTO, 'network' | 'allowedDomains' | 'diskMb' | 'setupScript' | 'commitSessionLink'> & { envVars: Record<string, string> } = {
    network: 'trusted', allowedDomains: [], diskMb: 512, setupScript: '', commitSessionLink: false, envVars: {},
  };

  try {
    if (!deps.sandbox) throw new HttpError(503, 'upstream_unavailable', 'Code sandbox bu sunucuda yapılandırılmamış.');
    const defs = deps.tools.forCode();
    if (!defs.length) throw new HttpError(503, 'upstream_unavailable', 'Code araçları bu sunucuda kapalı.');
    const sandbox = deps.sandbox;

    // --- kredi, oturum, GitHub, ortam ---
    if (await code.creditsExhausted(user.id)) {
      const credits = await code.credits(user.id);
      throw new HttpError(429, 'quota_exceeded', 'Günlük Code kredin doldu. Yarın yenilenecek.', { resetsAt: credits.resetsAt, limit: credits.limit });
    }
    const session = await code.getSession(user.id, chat.id);
    if (!session) throw new HttpError(404, 'not_found', 'Code oturumu bulunamadı.');
    const gh = await code.getConnection(user.id);
    if (!gh) throw new HttpError(409, 'github_required', 'GitHub bağlantın yok ya da geçersiz. Hesabını yeniden bağla.');
    if (session.environmentId) {
      const e = await code.getEnvironment(user.id, session.environmentId).catch(() => null);
      if (e) env = { network: e.network, allowedDomains: e.allowedDomains, diskMb: e.diskMb, setupScript: e.setupScript, commitSessionLink: e.commitSessionLink, envVars: e.envVars ?? {} };
    }

    // --- sıra ---
    send({ type: 'phase', phase: 'queued', position: 0 });
    release = await deps.queue.acquire(user.id, signal, (position) => send({ type: 'phase', phase: 'queued', position }));
    await code.setSessionStatus(chat.id, 'running');

    // --- çalışma alanı ---
    send({ type: 'phase', phase: 'preparing' });
    const author = { name: gh.login, email: githubNoreply(gh.githubId, gh.login) };
    const prepareOnce = async () => {
      const out = await sandbox.prepare(
        {
          ...scope, repo: session.repo, baseBranch: session.baseBranch, workBranch: session.workBranch, token: gh.token, author,
          network: { mode: env.network, domains: env.allowedDomains }, diskMb: env.diskMb, setupScript: env.setupScript, env: env.envVars,
        },
        signal,
      );
      diskUsedMb = out.diskUsedMb;
      return out;
    };
    const prepare = async () => void (await prepareOnce());
    const wsPart: Extract<MessagePartDTO, { type: 'tool' }> = { type: 'tool', id: `ws-${Date.now().toString(36)}`, name: 'workspace', args: { repo: session.repo, branch: session.workBranch }, status: 'running' };
    buf.addTool(wsPart);
    send({ type: 'tool_start', id: wsPart.id, name: wsPart.name, args: wsPart.args });
    const wsStarted = Date.now();
    let prepared: Awaited<ReturnType<typeof prepareOnce>>;
    try {
      prepared = await prepareOnce();
    } catch (err) {
      if (signal.aborted) throw err;
      const msg = err instanceof Error ? err.message : 'Çalışma alanı hazırlanamadı.';
      Object.assign(wsPart, { status: 'error', output: msg, summary: msg.slice(0, 120), ms: Date.now() - wsStarted });
      send({ type: 'tool_end', id: wsPart.id, status: 'error', output: msg, summary: wsPart.summary, ms: wsPart.ms ?? 0 });
      throw new HttpError(502, 'upstream_unavailable', `Çalışma alanı hazırlanamadı: ${msg}`);
    }
    const wsSummary = prepared.cloned ? (user.locale === 'tr' ? 'klonlandı' : 'cloned') : user.locale === 'tr' ? 'hazır' : 'ready';
    Object.assign(wsPart, {
      status: 'done',
      summary: wsSummary,
      output: [`${session.repo} @ ${prepared.branch}`, prepared.setupRan ? `setup ${prepared.setupOk ? 'ok' : 'FAILED'}\n${prepared.setupOutput}` : ''].filter(Boolean).join('\n'),
      meta: { cloned: prepared.cloned, setupRan: prepared.setupRan, setupOk: prepared.setupOk, baseSha: prepared.baseSha },
      ms: Date.now() - wsStarted,
    });
    send({ type: 'tool_end', id: wsPart.id, status: 'done', output: wsPart.output ?? '', summary: wsSummary, meta: wsPart.meta, ms: wsPart.ms ?? 0 });
    buf.persist(true);

    let brief = '';
    try {
      brief = (await sandbox.exec(scope, WORKSPACE_BRIEF_COMMAND, 20, signal)).stdout;
    } catch {
      /* özet isteğe bağlı */
    }

    // --- konuşma ---
    send({ type: 'phase', phase: 'working' });
    const system = buildCodeSystemPrompt({
      locale: user.locale, repo: session.repo, baseBranch: session.baseBranch, workBranch: session.workBranch, network: env.network,
      allowedDomains: env.allowedDomains, diskMb: env.diskMb, brief,
      setupFailure: prepared.setupRan && prepared.setupOk === false ? prepared.setupOutput.slice(-1_500) : undefined,
    });
    const messages: AiMessage[] = [{ role: 'system', content: system }, ...fitHistory(g.history, Math.floor(config.CODE_CONTEXT_TOKENS * 0.6))];
    const specs = toolSpecs(defs);
    const specTokens = Math.max(SPEC_TOKENS_GUESS, estimate(JSON.stringify(specs)));
    const toolCtx = { user, signal, chatId: chat.id, code: { session: scope.session, diskMb: env.diskMb, prepare } };
    const seen: string[] = [];
    let lengthRetries = 0;

    // Adım sınırı YOK: ajan işi bitirene kadar sürer. Frenler: döngü kırıcı, kredi, bağlam doluluğu, mutlak süre ve kullanıcının Durdur'u.
    for (let step = 0; ; step++) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');

      const pruned = pruneToolResults(messages, { keepRecent: 8, trimTo: 700, budgetTokens: config.CODE_CONTEXT_TOKENS - specTokens });
      contextTokens = messagesTokens(pruned) + specTokens;
      if (contextTokens > config.CODE_CONTEXT_TOKENS * 1.1) {
        stopNote = t.context;
        break;
      }
      send({ type: 'context', tokens: contextTokens, limit: config.CODE_CONTEXT_TOKENS });
      void code.setContextTokens(chat.id, contextTokens).catch(() => {});

      let calls: AiToolCall[] = [];
      let stepText = '';
      let stepOut = 0;
      let truncated = false;
      for await (const chunk of ai.stream({
        messages: pruned, signal, mode: 'deep', route: 'code', tools: specs, patient: step > 0, onProvider: (n) => (provider = n),
      })) {
        if (chunk.type === 'reasoning') {
          buf.addReasoning(chunk.text);
          stepOut += chunk.text.length;
          send({ type: 'reasoning', delta: chunk.text });
        } else if (chunk.type === 'content') {
          buf.addText(chunk.text);
          stepText += chunk.text;
          stepOut += chunk.text.length;
          send({ type: 'delta', delta: chunk.text });
        } else if (chunk.type === 'truncated') {
          truncated = true;
        } else {
          calls = chunk.calls;
          stepOut += JSON.stringify(chunk.calls).length;
        }
      }
      buf.closeReasoning();

      // kredi (girdi hafif, çıktı tam; Claude yedeği Qwen ile aynı fiyat)
      const amount = creditsFor({ model: provider === 'claude' ? 'claude' : 'qwen', tokens: weightedTokens(contextTokens, Math.ceil(stepOut / 3.5)), diskUsedMb, diskQuotaMb: env.diskMb });
      try {
        await code.spend(user.id, amount);
      } catch (err) {
        if (err instanceof HttpError && err.code === 'quota_exceeded') {
          stopNote = t.credits;
          break;
        }
        throw err;
      }

      if (truncated && !calls.length) {
        if (lengthRetries >= MAX_LENGTH_RETRIES) {
          stopNote = t.length;
          break;
        }
        lengthRetries++;
        messages.push(
          { role: 'assistant', content: stepText },
          { role: 'user', content: '[System note] Your previous response was cut off by the output length limit. Do not apologize or recap. Break the remaining work into smaller pieces (for example write large files in several smaller steps) and continue.' },
        );
        continue;
      }
      if (!calls.length) break;

      messages.push({ role: 'assistant', content: stepText, tool_calls: calls });
      let loopStop = false;
      for (const call of calls.slice(0, MAX_CALLS_PER_STEP)) {
        let shown: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.function.arguments || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) shown = parsed;
        } catch {
          /* bozuk JSON: araç sonucu hata olarak döner */
        }
        const part: Extract<MessagePartDTO, { type: 'tool' }> = { type: 'tool', id: call.id, name: call.function.name, args: shown, status: 'running' };
        buf.addTool(part);
        send({ type: 'tool_start', id: part.id, name: part.name, args: part.args });
        const result = await runToolCall(defs, call, toolCtx);
        let output = result.output;
        // Döngü kırıcı: aynı araç + argüman + çıktı tekrar tekrar geliyorsa uyar, sonra durdur.
        const key = `${call.function.name}:${stable(shown)}:${hash(result.output.slice(0, 4_000))}`;
        seen.push(key);
        if (seen.length > 12) seen.shift();
        const repeats = seen.filter((k) => k === key).length;
        if (repeats >= LOOP_STOP) loopStop = true;
        else if (repeats >= LOOP_WARN) output += `\n[Warning: this exact call has produced this exact result ${repeats} times. Repeating it will not help. Change your approach, or stop and explain what blocks you.]`;
        if (call.function.name === 'bash' && typeof result.meta?.durationMs === 'number') sandboxMs += result.meta.durationMs;
        Object.assign(part, { status: result.status, output, summary: result.summary, meta: result.meta, ms: result.ms });
        send({ type: 'tool_end', id: part.id, status: result.status, output, summary: result.summary, meta: result.meta, ms: result.ms });
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        if (loopStop) break;
      }
      for (const extra of calls.slice(MAX_CALLS_PER_STEP)) messages.push({ role: 'tool', tool_call_id: extra.id, content: `Error: at most ${MAX_CALLS_PER_STEP} tool calls per turn.` });
      buf.persist(true);
      if (loopStop) {
        stopNote = t.loop;
        break;
      }
    }
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') status = 'stopped';
    else {
      status = 'error';
      runStatus = 'error';
      errorMessage = err instanceof HttpError ? { code: err.code, message: err.message } : { code: 'upstream_unavailable', message: 'Yanıt üretilirken bir hata oluştu.' };
      if (!(err instanceof HttpError)) log.error({ err }, 'Code üretim hatası');
    }
  }

  buf.closeReasoning();
  for (const p of buf.parts) {
    if (p.type === 'tool' && p.status === 'running') Object.assign(p, { status: 'error', summary: p.summary ?? 'Durduruldu', output: p.output ?? 'İptal edildi.' });
  }
  if (stopNote) buf.addText(`${buf.content.trim() ? '\n\n' : ''}${stopNote}`);

  // --- tur sonu: değişiklikleri commit et (kullanıcı durdurmuş olsa da iş kaybolmasın) ---
  let changesEvent: Extract<StreamEvent, { type: 'changes' }> | null = null;
  if (deps.sandbox && release) {
    const fresh = new AbortController().signal;
    try {
      send({ type: 'phase', phase: 'committing' });
      const ch = await deps.sandbox.changes(scope, fresh);
      let sha: string | null = null;
      if (ch.files.length) {
        const turnFiles = ch.files;
        let subject = '';
        try {
          subject = commitSubject(await ai.complete({ messages: commitMessagePrompt(g.userText, turnFiles, user.locale), route: 'code', effort: 'low', temperature: 0.2, mode: 'deep' }), '');
        } catch (err) {
          log.warn({ err: String(err) }, 'commit mesajı üretilemedi, yedek kullanılıyor');
        }
        if (!subject) subject = commitSubject(`chore: ${g.userText.split('\n')[0] ?? ''}`);
        const body = turnFiles.slice(0, 20).map((f) => `- ${f.path} (+${f.additions} −${f.deletions})`).join('\n');
        const message = buildCommitMessage(subject, body, { sessionUrl: env.commitSessionLink ? `${config.PUBLIC_WEB_URL.replace(/\/$/, '')}/code/s/${chat.id}` : null });
        const c = await deps.sandbox.commit(scope, message, fresh);
        sha = c.sha;
        if (sha) {
          const part: Extract<MessagePartDTO, { type: 'tool' }> = {
            type: 'tool', id: `commit-${sha.slice(0, 7)}`, name: 'commit', args: { message: subject }, status: 'done', summary: sha.slice(0, 7),
            output: message, meta: { sha, subject, files: ch.files.length, additions: ch.additions, deletions: ch.deletions }, ms: 0,
          };
          buf.parts.push(part);
          send({ type: 'tool_start', id: part.id, name: part.name, args: part.args });
          send({ type: 'tool_end', id: part.id, status: 'done', output: message, summary: part.summary, meta: part.meta, ms: 0 });
        }
      }
      const usage = await deps.sandbox.usage(scope, fresh).catch(() => null);
      if (usage) diskUsedMb = usage.diskUsedMb;
      await code.updateSessionStats(chat.id, { additions: ch.additions, deletions: ch.deletions, filesChanged: ch.files.length, headSha: sha, diskUsedMb, contextTokens });
      changesEvent = { type: 'changes', additions: ch.additions, deletions: ch.deletions, files: ch.files.length, sha };
    } catch (err) {
      log.warn({ err: String(err) }, 'Code tur sonu commit/değişiklik özeti başarısız');
    }
    // sandbox süresi + disk kirası kredisi
    try {
      if (sandboxMs > 0) await code.spend(user.id, creditsFor({ sandboxSeconds: sandboxMs / 1000, diskUsedMb, diskQuotaMb: env.diskMb }));
    } catch {
      /* kredi bitmişse bu tur zaten durdu */
    }
  }
  release?.();
  await code.setSessionStatus(chat.id, runStatus).catch(() => {});

  const saved = await db.query<MessageRow>(
    `update messages set content = $2, reasoning = $3, reasoning_ms = $4, status = $5, model = $6, tokens_out = $7, parts = $8
      where id = $1 returning ${MESSAGE_COLUMNS}`,
    [g.assistantId, buf.content, buf.reasoning, buf.reasoningMs, status, `code:${provider}`, Math.ceil(buf.content.length / 3.5), JSON.stringify(buf.parts)],
  );
  const assistant = toMessageDTO(saved.rows[0]!);
  await db.query('update chats set updated_at = now() where id = $1', [chat.id]).catch(() => {});
  if (errorMessage) send({ type: 'error', code: errorMessage.code, message: errorMessage.message });
  if (changesEvent) send(changesEvent);
  send({ type: 'done', assistantMessage: assistant });

  // --- başlık (ilk mesajda) ---
  if (status === 'complete' && g.isFirstExchange && !chat.title_generated) {
    let title = fallbackTitle(g.userText);
    try {
      title = cleanTitle(await ai.complete({ messages: titlePrompt(g.userText, buf.content || g.userText, user.locale), route: 'code', effort: 'low', temperature: 0.3, mode: 'deep' }), title);
    } catch (err) {
      log.warn({ err: String(err) }, 'Code başlığı üretilemedi, yedek kullanılıyor');
    }
    await db.query('update chats set title = $2, title_generated = true where id = $1 and title_generated = false', [chat.id, title]);
    send({ type: 'title', title });
  }
}
