import type { FastifyInstance } from 'fastify';
import type { AuthResponse, StreamEvent } from '@sixfinger/shared';
import { buildApp, type BuildOptions } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { AppContext } from '../src/context.ts';
import type { AiChunk, AiProvider, AiRequest } from '../src/services/ai.ts';
import type { Mailer } from '../src/lib/mailer.ts';
import { createTools, type ToolDef, type ToolsOptions } from '../src/services/tools/index.ts';

export interface FakeAi extends AiProvider {
  calls: AiRequest[];
  /** Bir sonraki stream için yanıt dizisi. */
  script: AiChunk[];
  /** Doluysa her stream çağrısı sırayla bir elemanı tüketir (çok turlu araç senaryoları). */
  steps: AiChunk[][];
  failWith: Error | null;
  completeText: string;
  delayMs: number;
}

export function createFakeAi(): FakeAi {
  const ai: FakeAi = {
    calls: [],
    script: [
      { type: 'reasoning', text: 'Düşünüyorum' },
      { type: 'content', text: 'Merhaba ' },
      { type: 'content', text: 'dünya!' },
    ],
    steps: [],
    failWith: null,
    completeText: 'Selamlaşma Sohbeti',
    delayMs: 0,
    async *stream(req) {
      ai.calls.push(req);
      if (ai.failWith) throw ai.failWith;
      const chunks = ai.steps.length ? ai.steps.shift()! : ai.script;
      for (const c of chunks) {
        if (ai.delayMs) await new Promise((r) => setTimeout(r, ai.delayMs));
        if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield c;
      }
    },
    async complete(req) {
      ai.calls.push(req);
      return ai.completeText;
    },
  };
  return ai;
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  ai: FakeAi;
  mails: Array<{ to: string; code: string; purpose: string }>;
}

export async function setup(extraTools: ToolDef[] = [], toolsOptions: ToolsOptions = {}, extra: Partial<BuildOptions> = {}): Promise<TestEnv> {
  const ai = createFakeAi();
  const mails: TestEnv['mails'] = [];
  const mailer: Mailer = {
    async sendCode({ to, code, purpose }) {
      mails.push({ to, code, purpose });
    },
  };
  const { app, ctx } = await buildApp({ config: loadConfig(), ai, mailer, tools: createTools(extraTools, toolsOptions), migrate: true, ...extra });
  // Testler gerçek yerleşik skill'lerden bağımsız kalsın (her test kendi skill'lerini ekler).
  ctx.skills.builtin.clear();
  await app.ready();
  return { app, ctx, ai, mails };
}

export async function resetDb(ctx: AppContext) {
  await ctx.db.query(
    'truncate users, chats, messages, memories, shares, usage_daily, usage_ip, email_codes, refresh_tokens, user_settings, github_connections, code_environments, code_sessions, code_credit_daily restart identity cascade',
  );
}

export const auth = (a: AuthResponse) => ({ authorization: `Bearer ${a.accessToken}` });

export async function guest(app: FastifyInstance): Promise<AuthResponse> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
  if (r.statusCode !== 201) throw new Error(`guest failed: ${r.body}`);
  return r.json();
}

let n = 0;
/** Kayıtlı ve (isteğe bağlı) doğrulanmış kullanıcı oluşturur. */
export async function member(env: TestEnv, opts: { verify?: boolean; email?: string } = {}): Promise<AuthResponse> {
  const email = opts.email ?? `user${++n}-${Date.now()}@example.com`;
  const r = await env.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'correct-horse-battery', displayName: 'Test Kullanıcı' },
  });
  if (r.statusCode !== 201) throw new Error(`register failed: ${r.body}`);
  const session: AuthResponse = r.json();
  if (opts.verify !== false) {
    await new Promise((res) => setTimeout(res, 20));
    const mail = [...env.mails].reverse().find((m) => m.to === email && m.purpose === 'verify');
    if (!mail) throw new Error('verify mail yok');
    const v = await env.app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      headers: auth(session),
      payload: { code: mail.code },
    });
    if (v.statusCode !== 200) throw new Error(`verify failed: ${v.body}`);
    return { ...session, user: v.json().user };
  }
  return session;
}

export function parseSse(body: string): StreamEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((b) => b.startsWith('data:'))
    .map((b) => JSON.parse(b.slice(5).trim()) as StreamEvent);
}

export async function newChat(app: FastifyInstance, a: AuthResponse, payload: object = {}) {
  const r = await app.inject({ method: 'POST', url: '/api/chats', headers: auth(a), payload });
  if (r.statusCode !== 201) throw new Error(`chat create failed: ${r.body}`);
  return r.json().chat as { id: string };
}
