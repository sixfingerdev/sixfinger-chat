import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatDetailDTO, MessageDTO, StreamEvent } from '@sixfinger/shared';
import { loadConfig } from '../src/config.ts';
import type { AiChunk } from '../src/services/ai.ts';
import { createGithub } from '../src/services/github.ts';
import { auth, guest, member, newChat, parseSse, resetDb, setup, type TestEnv } from './helpers.ts';
import { fakeCode } from './fake-code.ts';
import { startFakeMcp, type FakeMcp } from './fake-mcp.ts';

type Session = Awaited<ReturnType<typeof member>>;
let fake: FakeMcp;
beforeAll(async () => {
  fake = await startFakeMcp();
});
afterAll(async () => {
  await fake.close();
});

const call = (id: string, name: string, args: object): AiChunk => ({ type: 'tool_calls', calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const text = (t: string): AiChunk => ({ type: 'content', text: t });

async function addFake(env: TestEnv, a: Session, over: Record<string, unknown> = {}) {
  const r = await env.app.inject({ method: 'POST', url: '/api/mcp/servers', headers: auth(a), payload: { label: 'Deneme Sunucu', url: fake.url, ...over } });
  expect(r.statusCode).toBe(201);
  return r.json().server as { id: string };
}

async function send(env: TestEnv, a: Session, chatId: string, content: string) {
  const r = await env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload: { content } });
  return { status: r.statusCode, events: r.statusCode === 200 ? parseSse(r.body) : ([] as StreamEvent[]) };
}
const detail = async (env: TestEnv, a: Session, id: string) => (await env.app.inject({ method: 'GET', url: `/api/chats/${id}`, headers: auth(a) })).json() as ChatDetailDTO;
const lastAssistant = (d: ChatDetailDTO): MessageDTO => d.messages.filter((m) => m.role === 'assistant').at(-1)!;
const toolNames = (env: TestEnv, i: number) => (env.ai.calls[i]?.tools ?? []).map((t) => t.function.name);
const approve = (env: TestEnv, a: Session, id: string, decision: 'once' | 'always' | 'deny') =>
  env.app.inject({ method: 'POST', url: `/api/mcp/approvals/${id}`, headers: auth(a), payload: { decision } });

describe('Chat: bağlayıcılar (MCP)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup([], {}, { mcpFetch: fetch as never });
  });
  afterAll(async () => {
    await env.app.close();
  });
  beforeEach(async () => {
    await resetDb(env.ctx);
    env.ai.calls.length = 0;
    env.ai.steps.length = 0;
    env.ai.failWith = null;
    env.ai.completeText = 'Başlık';
    fake.calls.length = 0;
    fake.oauth = false;
    fake.requireAuth = null;
  });

  it('salt okunur MCP aracı sohbette otomatik çalışır; istemde bağlayıcı bölümü ve araç listesi vardır', async () => {
    const a = await member(env);
    await addFake(env, a);
    const chat = await newChat(env.app, a);
    env.ai.steps = [[text('Bakayım. '), call('c1', 'mcp__deneme-sunucu__echo', { text: 'merhaba' })], [text('Sonuç hazır.')]];
    const r = await send(env, a, chat.id, 'echo dene');
    expect(r.status).toBe(200);
    const system = String(env.ai.calls[0]!.messages[0]!.content);
    expect(system).toContain('## Connectors (MCP)');
    expect(system).toContain('Deneme Sunucu (4 tools)');
    expect(toolNames(env, 0)).toEqual(expect.arrayContaining(['mcp__deneme-sunucu__echo', 'mcp__deneme-sunucu__create_note']));
    const end = r.events.find((e) => e.type === 'tool_end') as Extract<StreamEvent, { type: 'tool_end' }>;
    expect(end).toMatchObject({ id: 'c1', status: 'done' });
    expect(end.output).toContain('yankı: merhaba');
    const m = lastAssistant(await detail(env, a, chat.id));
    expect(m.status).toBe('complete');
    expect(m.parts.find((p) => p.type === 'tool')).toMatchObject({ name: 'mcp__deneme-sunucu__echo', status: 'done', meta: { server: 'Deneme Sunucu', tool: 'echo' } });
    expect(fake.calls).toEqual([{ tool: 'echo', args: { text: 'merhaba' } }]);
    // araç sonucu modele geri verildi (ikinci tur)
    expect(env.ai.calls[1]!.messages.some((x) => x.role === 'tool' && String(x.content).includes('yankı: merhaba'))).toBe(true);
  });

  it('yazan araç: tur onay beklerken biter (kart verisi + not), onaydan sonra yeni mesajla çalışır', async () => {
    const a = await member(env);
    await addFake(env, a);
    const chat = await newChat(env.app, a);
    env.ai.steps = [[text('Not ekliyorum. '), call('c1', 'mcp__deneme-sunucu__create_note', { title: 'Alışveriş' })], [text('BU TUR ASLA GELMEMELİ')]];
    const r = await send(env, a, chat.id, 'not oluştur');
    expect(env.ai.calls.filter((c) => c.tools?.length)).toHaveLength(1); // tur sonlandı: ikinci model çağrısı yok
    const end = r.events.find((e) => e.type === 'tool_end') as Extract<StreamEvent, { type: 'tool_end' }>;
    expect(end.meta).toMatchObject({ terminal: true, approval: { server: 'Deneme Sunucu', tool: 'create_note', args: { title: 'Alışveriş' } } });
    const m = lastAssistant(await detail(env, a, chat.id));
    expect(m.status).toBe('complete');
    expect(m.content).toContain('onayını bekliyorum');
    expect(m.content).not.toContain('ASLA');
    const tool = m.parts.find((p) => p.type === 'tool') as Extract<MessageDTO['parts'][number], { type: 'tool' }>;
    const id = (tool.meta!.approval as { id: string }).id;
    expect(fake.calls).toEqual([]);

    expect((await approve(env, a, id, 'once')).statusCode).toBe(200);
    env.ai.steps = [[call('c2', 'mcp__deneme-sunucu__create_note', { title: 'Alışveriş' })], [text('Eklendi.')]];
    const r2 = await send(env, a, chat.id, 'Onayladım, devam et.');
    expect(r2.status).toBe(200);
    expect(fake.calls).toEqual([{ tool: 'create_note', args: { title: 'Alışveriş' } }]);
    const m2 = lastAssistant(await detail(env, a, chat.id));
    expect(m2.content).toContain('Eklendi.');
    // önceki turun onay notu geçmişte modele görünür (devam bağlamı)
    expect(env.ai.calls.at(-2)!.messages.some((x) => x.role === 'tool' && String(x.content).includes('ONAY GEREKİYOR'))).toBe(true);
  });

  it('reddedilen çağrı çalışmaz; kapsam/etkin/misafir/başka kullanıcı: araç listesine girmez', async () => {
    const a = await member(env);
    const b = await member(env);
    const s = await addFake(env, a);
    const chat = await newChat(env.app, a);
    env.ai.steps = [[call('c1', 'mcp__deneme-sunucu__create_note', { title: 'X' })]];
    await send(env, a, chat.id, 'yaz');
    const tool = lastAssistant(await detail(env, a, chat.id)).parts.find((p) => p.type === 'tool') as Extract<MessageDTO['parts'][number], { type: 'tool' }>;
    expect((await approve(env, a, (tool.meta!.approval as { id: string }).id, 'deny')).json().approval.status).toBe('denied');
    expect(fake.calls).toEqual([]);

    // yalnızca Code kapsamı: sohbette yok
    await env.app.inject({ method: 'PATCH', url: `/api/mcp/servers/${s.id}`, headers: auth(a), payload: { scopes: ['code'] } });
    env.ai.calls.length = 0;
    env.ai.steps = [[text('tamam')]];
    await send(env, a, (await newChat(env.app, a)).id, 'selam');
    expect(toolNames(env, 0).some((n) => n.startsWith('mcp__'))).toBe(false);
    expect(String(env.ai.calls[0]!.messages[0]!.content)).not.toContain('Connectors (MCP)');
    // başka kullanıcı ve misafir
    env.ai.steps = [[text('tamam')]];
    await send(env, b, (await newChat(env.app, b)).id, 'selam');
    expect(toolNames(env, 1).some((n) => n.startsWith('mcp__'))).toBe(false);
    const g = await guest(env.app);
    env.ai.steps = [[text('tamam')]];
    await send(env, g, (await newChat(env.app, g)).id, 'selam');
    expect(toolNames(env, 2).some((n) => n.startsWith('mcp__'))).toBe(false);
  });

  it('"hep izin ver"den sonra yazan araç sormadan çalışır', async () => {
    const a = await member(env);
    const s = await addFake(env, a);
    await env.app.inject({ method: 'PATCH', url: `/api/mcp/servers/${s.id}`, headers: auth(a), payload: { allowTools: ['create_note'] } });
    const chat = await newChat(env.app, a);
    env.ai.steps = [[call('c1', 'mcp__deneme-sunucu__create_note', { title: 'Hemen' })], [text('Oldu.')]];
    await send(env, a, chat.id, 'yaz');
    expect(fake.calls).toEqual([{ tool: 'create_note', args: { title: 'Hemen' } }]);
    expect(lastAssistant(await detail(env, a, chat.id)).content).toContain('Oldu.');
  });
});

describe('Code: bağlayıcılar (MCP)', () => {
  let env: TestEnv;
  let fc: ReturnType<typeof fakeCode>;
  beforeAll(async () => {
    fc = fakeCode({ 'app.js': 'console.log(1);\n' });
    const config = loadConfig();
    env = await setup([], { code: fc.client }, { config, codeSandbox: fc.client, github: createGithub(config, (async () => new Response('{}')) as unknown as typeof fetch), mcpFetch: fetch as never });
  });
  afterAll(async () => {
    await env.app.close();
  });
  beforeEach(async () => {
    await resetDb(env.ctx);
    env.ai.calls.length = 0;
    env.ai.steps.length = 0;
    env.ai.completeText = 'Başlık';
    fake.calls.length = 0;
  });
  async function prepared() {
    const a = await member(env, { email: 'coder@example.com' });
    await env.ctx.code.saveConnection(a.user.id, { id: 42, login: 'octo', avatarUrl: '' }, 'gho_testtoken', 'repo');
    const s = await env.ctx.code.createSession(a.user.id, { repo: 'octo/alpha', baseBranch: 'main' });
    await env.ctx.db.query('update code_environments set auto_pr = false where user_id = $1', [a.user.id]);
    fc.state.execImpl = (c) => (c.startsWith('ls -1Ap') ? { stdout: 'app.js\n' } : {});
    return { a, s };
  }
  const agentCalls = () => env.ai.calls.filter((c) => c.route === 'code' && c.tools?.length);

  it('Code ajanı MCP araçlarını görür ve salt okunur olanı çağırır; istemde bağlayıcı bölümü var', async () => {
    const { a, s } = await prepared();
    await addFake(env, a);
    env.ai.steps = [[call('c1', 'mcp__deneme-sunucu__echo', { text: 'kod' })], text('Bitti.')];
    const r = await send(env, a, s.chatId, 'mcp dene');
    expect(r.status).toBe(200);
    const names = agentCalls()[0]!.tools!.map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['bash', 'mcp__deneme-sunucu__echo', 'mcp__deneme-sunucu__create_note']));
    expect(String(agentCalls()[0]!.messages[0]!.content)).toContain('## Connectors (MCP)');
    expect(fake.calls).toEqual([{ tool: 'echo', args: { text: 'kod' } }]);
    const part = lastAssistant(await detail(env, a, s.chatId)).parts.find((p) => p.type === 'tool' && p.name.startsWith('mcp__'));
    expect(part).toMatchObject({ status: 'done' });
  });

  it('Code: yazan araç turu bitirir (terminal), onaydan sonra çalışır', async () => {
    const { a, s } = await prepared();
    await addFake(env, a);
    env.ai.steps = [[call('c1', 'mcp__deneme-sunucu__create_note', { title: 'Kod notu' })], text('ASLA GELMEMELİ')];
    const r = await send(env, a, s.chatId, 'not ekle');
    const end = r.events.find((e) => e.type === 'tool_end' && e.id === 'c1') as Extract<StreamEvent, { type: 'tool_end' }>;
    expect(end.meta).toMatchObject({ terminal: true, approval: { tool: 'create_note' } });
    expect(agentCalls()).toHaveLength(1);
    expect(fake.calls).toEqual([]);
    const tool = lastAssistant(await detail(env, a, s.chatId)).parts.find((p) => p.type === 'tool' && p.name.startsWith('mcp__')) as Extract<MessageDTO['parts'][number], { type: 'tool' }>;
    await approve(env, a, (tool.meta!.approval as { id: string }).id, 'once');
    env.ai.steps = [[call('c2', 'mcp__deneme-sunucu__create_note', { title: 'Kod notu' })], text('Eklendi.')];
    await send(env, a, s.chatId, 'Onayladım, devam et.');
    expect(fake.calls).toEqual([{ tool: 'create_note', args: { title: 'Kod notu' } }]);
  });

  it('Code: plan modunda yalnızca salt okunur MCP araçları; alt ajan yalnızca onay gerektirmeyenleri görür', async () => {
    const { a, s } = await prepared();
    await addFake(env, a);
    env.ai.steps = [text('plan')];
    await env.app.inject({ method: 'POST', url: `/api/chats/${s.chatId}/messages`, headers: auth(a), payload: { content: 'planla', planMode: true } });
    const names = agentCalls()[0]!.tools!.map((t) => t.function.name);
    expect(names).toContain('mcp__deneme-sunucu__echo');
    expect(names).not.toContain('mcp__deneme-sunucu__create_note');

    env.ai.calls.length = 0;
    env.ai.steps = [[call('t1', 'task', { description: 'araştır', prompt: 'echo kullan', agent: 'general' })], text('alt ajan raporu'), text('Bitti.')];
    await send(env, a, s.chatId, 'alt ajan çalıştır');
    const sub = env.ai.calls.find((c) => c.tools?.some((t) => t.function.name === 'read') && !c.tools.some((t) => t.function.name === 'task'));
    expect(sub).toBeTruthy();
    const subNames = sub!.tools!.map((t) => t.function.name);
    expect(subNames).toContain('mcp__deneme-sunucu__echo');
    expect(subNames).not.toContain('mcp__deneme-sunucu__create_note');
  });
});
