import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatDetailDTO, StreamEvent } from '@sixfinger/shared';
import { auth, member, newChat, resetDb, setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
let base = '';
beforeAll(async () => {
  env = await setup();
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = env.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb(env.ctx);
  env.ai.calls.length = 0;
  env.ai.failWith = null;
  env.ai.completeText = 'Başlık';
  // 12 parça, aralarında 60 ms: yaklaşık 0,7 sn süren bir yanıt.
  env.ai.delayMs = 60;
  env.ai.script = Array.from({ length: 12 }, (_, i) => ({ type: 'content' as const, text: `p${i} ` }));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Session = Awaited<ReturnType<typeof member>>;

async function open(a: Session, chatId: string, content: string) {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { ...auth(a), 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
    signal: ac.signal,
  });
  return { res, ac };
}
async function readUntil(res: Response, stop: (e: StreamEvent) => boolean, max = 5000) {
  const events: StreamEvent[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const e = JSON.parse(line.slice(5)) as StreamEvent;
      events.push(e);
      if (stop(e)) {
        reader.cancel().catch(() => {});
        return events;
      }
    }
  }
  return events;
}
const detail = async (a: Session, id: string) =>
  (await (await fetch(`${base}/api/chats/${id}`, { headers: auth(a) })).json()) as ChatDetailDTO;
const assistant = (d: ChatDetailDTO) => d.messages.find((m) => m.role === 'assistant')!;

describe('arka planda üretim', () => {
  it('istemci bağlantıyı kapatsa da üretim sürer ve sonuç kaydedilir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const { res, ac } = await open(m, chat.id, 'uzun bir şey yaz');
    await readUntil(res, (e) => e.type === 'delta'); // ilk parça geldi
    ac.abort(); // uygulama kapandı
    await sleep(1500);
    const a = assistant(await detail(m, chat.id));
    expect(a.status).toBe('complete');
    expect(a.content).toContain('p11');
  });

  it('süren üretime sonradan bağlanınca önce anlık görüntü, sonra canlı olaylar gelir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const first = await open(m, chat.id, 'yaz');
    await readUntil(first.res, (e) => e.type === 'delta');
    first.ac.abort();
    await sleep(150);
    const follow = await fetch(`${base}/api/chats/${chat.id}/stream`, { headers: auth(m) });
    expect(follow.status).toBe(200);
    const events = await readUntil(follow, (e) => e.type === 'done');
    expect(events[0]!.type).toBe('snapshot');
    const snap = events[0] as Extract<StreamEvent, { type: 'snapshot' }>;
    expect(snap.assistantMessage.status).toBe('streaming');
    expect(snap.assistantMessage.content.length).toBeGreaterThan(0);
    // anlık görüntü + sonradan gelen parçalar = tam yanıt
    const tail = events.filter((e) => e.type === 'delta').map((e) => (e as { delta: string }).delta).join('');
    const done = events.at(-1) as Extract<StreamEvent, { type: 'done' }>;
    expect(snap.assistantMessage.content + tail).toBe(done.assistantMessage.content);
    expect(done.assistantMessage.content).toContain('p11');
  });

  it('üretim yokken izleme ucu 204 döner', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const r = await fetch(`${base}/api/chats/${chat.id}/stream`, { headers: auth(m) });
    expect(r.status).toBe(204);
  });

  it('durdur ucu üretimi durdurur; kısmi yanıt stopped olarak kalır', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const { res, ac } = await open(m, chat.id, 'yaz');
    await readUntil(res, (e) => e.type === 'delta');
    ac.abort();
    const stop = await fetch(`${base}/api/chats/${chat.id}/stop`, { method: 'POST', headers: auth(m) });
    expect(((await stop.json()) as { stopped: boolean }).stopped).toBe(true);
    await sleep(400);
    const a = assistant(await detail(m, chat.id));
    expect(a.status).toBe('stopped');
    expect(a.content).not.toContain('p11');
  });

  it('bir sohbette üretim sürerken başka bir sohbette mesaj gönderilebilir; aynı sohbette 409 döner', async () => {
    const m = await member(env);
    const c1 = await newChat(env.app, m);
    const c2 = await newChat(env.app, m);
    const a = await open(m, c1.id, 'birinci');
    await readUntil(a.res, (e) => e.type === 'delta');
    const b = await open(m, c2.id, 'ikinci');
    expect(b.res.status).toBe(200);
    const again = await open(m, c1.id, 'aynı sohbete');
    expect(again.res.status).toBe(409);
    await readUntil(b.res, (e) => e.type === 'done');
    await readUntil(a.res, (e) => e.type === 'done').catch(() => {});
  });

  it('bayat "streaming" mesajı (üretim yok) sohbet açılınca stopped yapılır', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const row = await env.ctx.db.query<{ id: string }>(
      `insert into messages (chat_id, role, status, created_at) values ($1, 'assistant', 'streaming', now() - interval '5 minutes') returning id`,
      [chat.id],
    );
    const d = await detail(m, chat.id);
    expect(d.messages.find((x) => x.id === row.rows[0]!.id)!.status).toBe('stopped');
  });

  it('kesilen yanıtta açık kalan artifact kapatılır ve not eklenir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.delayMs = 0;
    env.ai.script = [
      { type: 'content', text: '<artifact id="a" title="T" type="html">\n<p>yarım' },
      { type: 'truncated' },
    ];
    const { res } = await open(m, chat.id, 'artifact yaz');
    const events = await readUntil(res, (e) => e.type === 'done');
    const done = events.at(-1) as Extract<StreamEvent, { type: 'done' }>;
    expect(done.assistantMessage.content).toContain('</artifact>');
    expect(done.assistantMessage.content).toContain('Devam et');
  });
});
