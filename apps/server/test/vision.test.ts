import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { createAi, wireMessage, type AiMessage } from '../src/services/ai.ts';
import { toConverse } from '../src/services/bedrock.ts';
import { auth, member, newChat, resetDb, setup, type TestEnv } from './helpers.ts';

// 1x1 piksel PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const IMG = { mime: 'image/png', data: PNG };

const sse = (chunks: object[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

describe('görselli isteklerde sağlayıcı zinciri', () => {
  it('yalnızca görsel destekleyen modellere gider: MiniMax → Qwen (OVH); gpt-oss, DeepSeek, GLM, Pollinations denenmez', async () => {
    const calls: Array<{ url: string; body: { model: string; messages: Array<{ content: unknown; images?: unknown }> } }> = [];
    const fetchMock = async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      // Kilo (MiniMax) hata verir → zincir Qwen'e düşer.
      if (url.includes('kilo.ai')) return new Response('{"error":"x"}', { status: 400 });
      return sse([{ choices: [{ index: 0, delta: { content: 'Kırmızı bir kare.' } }] }]);
    };
    const ai = createAi({ ...loadConfig(), AI_FREE_ENABLED: true }, undefined, fetchMock as unknown as typeof fetch);
    const out: string[] = [];
    for await (const c of ai.stream({ mode: 'fast', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'Bu ne?', images: [IMG] }] })) if (c.type === 'content') out.push(c.text);
    expect(out.join('')).toBe('Kırmızı bir kare.');
    expect(calls.map((c) => [new URL(c.url).hostname, c.body.model])).toEqual([
      ['api.kilo.ai', 'minimax/minimax-m3.1-flash:free'],
      ['oai.endpoints.kepler.ai.cloud.ovh.net', 'Qwen3.8-27B'],
    ]);
    // OpenAI biçimi: içerik dizisi (metin + image_url); iç `images` alanı dışarı gitmez.
    const user = calls[0]!.body.messages[1]!;
    expect(user.images).toBeUndefined();
    expect(user.content).toEqual([
      { type: 'text', text: 'Bu ne?' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);
  });

  it('Code: görselli istek (read ile açılan resim) yalnızca görsel destekleyenlere gider; DeepSeek/GLM/gpt-oss denenmez', async () => {
    const calls: string[] = [];
    const fetchMock = async (url: string, init: { body: string }) => {
      calls.push(`${new URL(url).hostname}|${JSON.parse(init.body).model}`);
      if (url.includes('kilo.ai')) return new Response('x', { status: 400 });
      return sse([{ choices: [{ index: 0, delta: { content: 'ok' } }] }]);
    };
    const ai = createAi({ ...loadConfig(), AI_FREE_ENABLED: true, AI_FREE_FOR_CODE: true }, undefined, fetchMock as unknown as typeof fetch);
    for await (const _ of ai.stream({ route: 'code', mode: 'deep', messages: [{ role: 'user', content: 'bak', images: [IMG] }] })) void _;
    expect(calls).toEqual(['api.kilo.ai|minimax/minimax-m3.1-flash:free', 'oai.endpoints.kepler.ai.cloud.ovh.net|Qwen3.8-27B']);
  });

  it('görselsiz istek eskisi gibi (içerik düz metin)', () => {
    const m: AiMessage = { role: 'user', content: 'merhaba' };
    expect(wireMessage(m)).toEqual({ role: 'user', content: 'merhaba' });
  });

  it('Bedrock: görsel Converse image bloğuna çevrilir', () => {
    const { messages } = toConverse([{ role: 'user', content: 'Bu ne?', images: [{ mime: 'image/jpeg', data: PNG }] }]);
    const blocks = messages[0]!.content!;
    expect(blocks[0]).toEqual({ text: 'Bu ne?' });
    expect(blocks[1]).toMatchObject({ image: { format: 'jpeg' } });
    expect(Buffer.from((blocks[1] as { image: { source: { bytes: Uint8Array } } }).image.source.bytes).toString('base64')).toBe(PNG);
  });
});

describe('görsel ekleme (API)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await env.app.close();
  });
  beforeEach(async () => {
    await resetDb(env.ctx);
    env.ai.calls.length = 0;
    env.ai.script = [{ type: 'content', text: 'Küçük bir görsel.' }];
  });

  const send = (a: Awaited<ReturnType<typeof member>>, chatId: string, content: string, images: unknown[]) =>
    env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload: { content, images } });

  it('görsel saklanır, modele gider, DTO başvuru döner ve baytlar yalnızca sahibine verilir', async () => {
    const a = await member(env);
    const b = await member(env);
    const chat = await newChat(env.app, a);
    const r = await send(a, chat.id, 'Bu ne?', [{ name: 'foto.png', mime: 'image/png', data: PNG }]);
    expect(r.statusCode).toBe(200);
    const start = r.body.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:'))).filter(Boolean).map((l) => JSON.parse(l!.slice(5))).find((e) => e.type === 'start');
    const ref = start.userMessage.images[0];
    expect(ref).toMatchObject({ name: 'foto.png', mime: 'image/png' });

    // Model görseli aldı.
    const req = env.ai.calls.find((c) => c.messages.some((m) => m.role === 'user' && m.images?.length))!;
    expect(req.messages.find((m) => m.role === 'user')!.images).toEqual([{ mime: 'image/png', data: PNG }]);

    // Ayrıntı yanıtı başvuruyu içerir; baytlar ayrı uçtan.
    const detail = (await env.app.inject({ method: 'GET', url: `/api/chats/${chat.id}`, headers: auth(a) })).json();
    expect(detail.messages.find((m: { role: string }) => m.role === 'user').images[0].id).toBe(ref.id);
    const bytes = await env.app.inject({ method: 'GET', url: `/api/images/${ref.id}`, headers: auth(a) });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/png');
    expect(bytes.rawPayload.toString('base64')).toBe(PNG);
    expect((await env.app.inject({ method: 'GET', url: `/api/images/${ref.id}`, headers: auth(b) })).statusCode).toBe(404);
  });

  it('geçersiz görsel reddedilir; misafir ve doğrulanmamış hesap kullanamaz; kota düşülmez', async () => {
    const a = await member(env);
    const chat = await newChat(env.app, a);
    const fake = Buffer.from('bu bir resim değil, düz metin').toString('base64');
    expect((await send(a, chat.id, 'x', [{ mime: 'image/png', data: fake }])).statusCode).toBe(400);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_000_000)]).toString('base64');
    expect((await send(a, chat.id, 'x', [{ mime: 'image/jpeg', data: big }])).statusCode).toBe(400);
    expect((await send(a, chat.id, 'x', Array(5).fill({ mime: 'image/png', data: PNG }))).statusCode).toBe(400);

    const unverified = await member(env, { verify: false });
    const c2 = await newChat(env.app, unverified);
    expect((await send(unverified, c2.id, 'x', [{ mime: 'image/png', data: PNG }])).statusCode).toBe(403);
  });

  it('geçmişte yalnızca en yeni 2 görselli mesaj görseli taşır; eskisinin yerine metin notu girer', async () => {
    const a = await member(env);
    const chat = await newChat(env.app, a);
    for (const n of [1, 2, 3]) {
      const r = await send(a, chat.id, `soru ${n}`, [{ name: `g${n}.png`, mime: 'image/png', data: PNG }]);
      expect(r.statusCode).toBe(200);
    }
    const last = env.ai.calls.filter((c) => c.messages.some((m) => m.images?.length)).pop()!;
    const users = last.messages.filter((m) => m.role === 'user');
    expect(users.map((m) => m.images?.length ?? 0)).toEqual([0, 1, 1]);
    expect(users[0]!.content).toContain('[Eklenen görsel: g1.png');
  });
});
