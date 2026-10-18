import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatDetailDTO, MessageDTO, StreamEvent } from '@sixfinger/shared';
import type { AiChunk } from '../src/services/ai.ts';
import { createSandboxClient } from '../src/services/tools/index.ts';
import { loadConfig as loadSandboxConfig } from '../../sandboxd/src/config.ts';
import { LocalRuntime } from '../../sandboxd/src/runtime/local.ts';
import { buildServer } from '../../sandboxd/src/server.ts';
import { SandboxService } from '../../sandboxd/src/service.ts';
import { auth, guest, member, newChat, parseSse, resetDb, setup, type TestEnv } from './helpers.ts';

// Gerçek sandboxd (yerel çalıştırıcıyla) + gerçek HTTP istemcisi + sahte yapay zekâ.
const TOKEN = 'integration-token-integration-token';
let env: TestEnv;
let stop: () => Promise<void>;

beforeAll(async () => {
  const cfg = loadSandboxConfig({ SANDBOXD_TOKEN: TOKEN, SANDBOX_RUNTIME: 'local-unsafe', SANDBOX_DATA_DIR: '/tmp/sf-int' } as NodeJS.ProcessEnv);
  const runtime = new LocalRuntime();
  const service = new SandboxService(cfg, runtime, { info() {}, warn() {}, error() {} });
  const server = buildServer(service, cfg, { logger: false });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  stop = async () => {
    await server.close();
    runtime.cleanup();
  };
  env = await setup([], { sandbox: createSandboxClient(url, TOKEN) });
});
afterAll(async () => {
  await env.app.close();
  await stop();
});
beforeEach(async () => {
  await resetDb(env.ctx);
  env.ai.calls.length = 0;
  env.ai.steps.length = 0;
  env.ai.completeText = 'Sandbox Sohbeti';
});

const call = (id: string, name: string, args: object): AiChunk => ({ type: 'tool_calls', calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const text = (t: string): AiChunk => ({ type: 'content', text: t });
const main = () => env.ai.calls.filter((c) => c.messages[0]?.content.includes('SixFinger AI'));

async function send(a: Awaited<ReturnType<typeof guest>>, chatId: string, content = 'çalıştır') {
  const r = await env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload: { content } });
  return parseSse(r.body) as StreamEvent[];
}
const last = async (a: Awaited<ReturnType<typeof guest>>, id: string): Promise<MessageDTO> =>
  ((await env.app.inject({ method: 'GET', url: `/api/chats/${id}`, headers: auth(a) })).json() as ChatDetailDTO).messages.filter((m) => m.role === 'assistant').at(-1)!;

describe('sandbox araçları (uçtan uca)', () => {
  it('doğrulanmış üye: write → bash → edit → read zinciri çalışır', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.steps = [
      [call('1', 'write', { path: 'app.py', content: 'print("merhaba")\nprint(2 + 2)\n' })],
      [call('2', 'bash', { command: 'python3 app.py || echo "python yok"' })],
      [call('3', 'edit', { path: 'app.py', old_string: '2 + 2', new_string: '40 + 2' })],
      [call('4', 'read', { path: 'app.py' })],
      [text('Hazır.')],
    ];
    const events = await send(m, chat.id);
    const ends = events.filter((e): e is Extract<StreamEvent, { type: 'tool_end' }> => e.type === 'tool_end');
    expect(ends.map((e) => e.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(ends[0]!.output).toContain('Yazıldı: app.py');
    expect(ends[1]!.output).toMatch(/\$ python3 app\.py/);
    expect(ends[1]!.output).toMatch(/çıkış kodu \d/);
    expect(ends[2]!.output).toContain('Düzenlendi: app.py (1 değişiklik)');
    expect(ends[3]!.output).toContain('print(40 + 2)');
    expect(ends[3]!.output).toMatch(/\s1\tprint\("merhaba"\)/); // satır numaraları

    const msg = await last(m, chat.id);
    expect(msg.status).toBe('complete');
    expect(msg.parts.filter((p) => p.type === 'tool').map((p) => (p as { name: string }).name)).toEqual(['write', 'bash', 'edit', 'read']);
    expect(main()[0]!.tools?.map((t) => t.function.name)).toEqual(expect.arrayContaining(['bash', 'read', 'write', 'edit', 'web_search']));
  });

  it('sohbetler birbirinin dosyalarını görmez', async () => {
    const m = await member(env);
    const a = await newChat(env.app, m);
    const b = await newChat(env.app, m);
    env.ai.steps = [[call('1', 'write', { path: 'gizli.txt', content: 'a-sohbeti' })], [text('tamam')]];
    await send(m, a.id);
    env.ai.steps = [[call('2', 'read', { path: 'gizli.txt' })], [text('tamam')]];
    const events = await send(m, b.id);
    const end = events.find((e) => e.type === 'tool_end');
    expect(end).toMatchObject({ status: 'error' });
    expect((end as { output: string }).output).toMatch(/bulunamadı/);
  });

  it('araç hataları modele okunabilir döner (yol kaçışı, eşleşmeyen düzenleme)', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.steps = [
      [call('1', 'write', { path: '../etc/evil', content: 'x' })],
      [call('2', 'edit', { path: 'yok.txt', old_string: 'a', new_string: 'b' })],
      [text('ok')],
    ];
    const events = await send(m, chat.id);
    const ends = events.filter((e): e is Extract<StreamEvent, { type: 'tool_end' }> => e.type === 'tool_end');
    expect(ends[0]).toMatchObject({ status: 'error' });
    expect(ends[0]!.output).toMatch(/dışına/);
    expect(ends[1]).toMatchObject({ status: 'error' });
    expect(ends[1]!.output).toMatch(/bulunamadı/);
  });

  it('misafir ve doğrulanmamış hesap sandbox araçlarını hiç görmez', async () => {
    const g = await guest(env.app);
    const chat = await newChat(env.app, g);
    env.ai.steps = [[text('selam')]];
    await send(g, chat.id);
    const names = main()[0]!.tools?.map((t) => t.function.name) ?? [];
    expect(names).toContain('web_search');
    for (const n of ['bash', 'read', 'write', 'edit']) expect(names).not.toContain(n);

    // Model yine de çağırmaya çalışırsa: araç yok hatası, sandbox'a hiç gidilmez.
    env.ai.calls.length = 0;
    env.ai.steps = [[call('x', 'bash', { command: 'id' })], [text('olmadı')]];
    const events = await send(g, chat.id, 'dene');
    const end = events.find((e) => e.type === 'tool_end') as Extract<StreamEvent, { type: 'tool_end' }>;
    expect(end.status).toBe('error');
    expect(end.output).toMatch(/yok/);
  });

  it('sistem istemi sandbox kurallarını yalnızca yetkili kullanıcıya verir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.steps = [[text('x')]];
    await send(m, chat.id);
    expect(main()[0]!.messages[0]!.content).toContain('Sandbox:');
    env.ai.calls.length = 0;

    const u = await member(env, { verify: false });
    const c2 = await newChat(env.app, u);
    env.ai.steps = [[text('x')]];
    await send(u, c2.id);
    expect(main()[0]!.messages[0]!.content).not.toContain('Sandbox:');
  });
});
