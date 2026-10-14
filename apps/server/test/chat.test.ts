import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatDetailDTO, StreamEvent } from '@sixfinger/shared';
import { auth, guest, member, newChat, parseSse, resetDb, setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb(env.ctx);
  env.mails.length = 0;
  env.ai.calls.length = 0;
  env.ai.failWith = null;
  env.ai.delayMs = 0;
  env.ai.completeText = 'Selamlaşma Sohbeti';
  env.ai.script = [
    { type: 'reasoning', text: 'Düşünüyorum' },
    { type: 'content', text: 'Merhaba ' },
    { type: 'content', text: 'dünya!' },
  ];
});

async function send(a: Awaited<ReturnType<typeof guest>>, chatId: string, payload: object) {
  const r = await env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload });
  return { status: r.statusCode, raw: r, events: r.statusCode === 200 ? parseSse(r.body) : ([] as StreamEvent[]) };
}
const detail = async (a: Awaited<ReturnType<typeof guest>>, id: string) =>
  (await env.app.inject({ method: 'GET', url: `/api/chats/${id}`, headers: auth(a) })).json() as ChatDetailDTO;

describe('mesajlaşma ve akış', () => {
  it('yanıtı SSE ile akıtır, mesajları kaydeder ve başlık üretir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const { status, events } = await send(m, chat.id, { content: 'Selam!' });
    expect(status).toBe(200);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('reasoning');
    expect(types.filter((t) => t === 'delta')).toHaveLength(2);
    expect(types).toContain('usage');
    expect(types).toContain('done');
    expect(types.at(-1)).toBe('title');

    const done = events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' && done.assistantMessage.content).toBe('Merhaba dünya!');
    expect(done && done.type === 'done' && done.assistantMessage.reasoning).toBe('Düşünüyorum');
    expect(events.find((e) => e.type === 'title')).toMatchObject({ title: 'Selamlaşma Sohbeti' });

    const d = await detail(m, chat.id);
    expect(d.messages).toHaveLength(2);
    expect(d.chat.title).toBe('Selamlaşma Sohbeti');
    expect(d.chat.leafId).toBe(d.messages[1]!.id);
    expect(d.messages[1]!.status).toBe('complete');
  });

  it('modele sistem istemi ve geçmişle birlikte gider; kimlik SixFinger AI', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    await send(m, chat.id, { content: 'Kimsin?' });
    const call = env.ai.calls[0]!;
    expect(call.messages[0]!.role).toBe('system');
    expect(call.messages[0]!.content).toContain('SixFinger AI');
    expect(call.messages.at(-1)).toMatchObject({ role: 'user', content: 'Kimsin?' });
  });

  it('ikinci mesajda geçmiş modele iletilir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    await send(m, chat.id, { content: 'Bir' });
    env.ai.calls.length = 0;
    await send(m, chat.id, { content: 'İki' });
    const roles = env.ai.calls[0]!.messages.map((x) => x.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('yeniden üretme kardeş asistan mesajı oluşturur ve ucu ona taşır', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    await send(m, chat.id, { content: 'Selam' });
    const before = await detail(m, chat.id);
    const firstAssistant = before.messages.find((x) => x.role === 'assistant')!;

    env.ai.script = [{ type: 'content', text: 'Alternatif yanıt' }];
    const r = await env.app.inject({
      method: 'POST',
      url: `/api/chats/${chat.id}/regenerate`,
      headers: auth(m),
      payload: { messageId: firstAssistant.id },
    });
    expect(r.statusCode).toBe(200);
    const after = await detail(m, chat.id);
    const assistants = after.messages.filter((x) => x.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(assistants[0]!.parentId).toBe(assistants[1]!.parentId);
    expect(after.chat.leafId).toBe(assistants[1]!.id);
    expect(assistants[1]!.content).toBe('Alternatif yanıt');
  });

  it('düzenleme: aynı üst mesaja yeni kullanıcı mesajı eklenir (dallanma)', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    await send(m, chat.id, { content: 'İlk soru' });
    const d1 = await detail(m, chat.id);
    const firstUser = d1.messages.find((x) => x.role === 'user')!;

    const { status } = await send(m, chat.id, { content: 'Düzenlenmiş soru', parentId: firstUser.parentId });
    expect(status).toBe(200);
    const d2 = await detail(m, chat.id);
    const users = d2.messages.filter((x) => x.role === 'user');
    expect(users).toHaveLength(2);
    expect(users[0]!.parentId).toBeNull();
    expect(users[1]!.parentId).toBeNull();

    // eski sürüme geçiş: yaprak eski asistan mesajına döner
    const oldAssistant = d1.messages.find((x) => x.role === 'assistant')!;
    const sw = await env.app.inject({
      method: 'PATCH',
      url: `/api/chats/${chat.id}`,
      headers: auth(m),
      payload: { leafId: firstUser.id },
    });
    expect(sw.statusCode).toBe(200);
    expect(sw.json().chat.leafId).toBe(oldAssistant.id);
  });

  it('kullanıcı mesajının altına mesaj eklenemez', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    await send(m, chat.id, { content: 'x' });
    const d = await detail(m, chat.id);
    const u = d.messages.find((x) => x.role === 'user')!;
    const r = await send(m, chat.id, { content: 'y', parentId: u.id });
    expect(r.status).toBe(400);
  });

  it('üst servis hatasında hata olayı gelir, mesaj error olur ve hak iade edilir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const { HttpError } = await import('../src/lib/errors.ts');
    env.ai.failWith = new HttpError(503, 'upstream_busy', 'Yoğunuz');
    const { events } = await send(m, chat.id, { content: 'Selam' });
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'upstream_busy' });
    const d = await detail(m, chat.id);
    expect(d.messages.find((x) => x.role === 'assistant')!.status).toBe('error');
    const usage = await env.app.inject({ method: 'GET', url: '/api/usage', headers: auth(m) });
    expect(usage.json().used).toBe(0);
  });

  it('kısmi yanıt, istemci bağlantıyı keserse stopped olarak saklanır', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    // Üreteci akış ortasında durdur: imzayı taklit etmek için AbortError fırlat.
    env.ai.script = [
      { type: 'content', text: 'Yarım ' },
      { type: 'content', text: 'kaldı' },
    ];
    const orig = env.ai.stream;
    env.ai.stream = async function* (req) {
      yield { type: 'content', text: 'Yarım ' };
      throw new DOMException('aborted', 'AbortError');
      void req;
    };
    const { events } = await send(m, chat.id, { content: 'Selam' });
    env.ai.stream = orig;
    const done = events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' && done.assistantMessage.status).toBe('stopped');
    expect(done && done.type === 'done' && done.assistantMessage.content).toBe('Yarım ');
  });

  it('günlük kota aşılınca 429 quota_exceeded döner', async () => {
    const g = await guest(env.app);
    const chat = await newChat(env.app, g);
    await env.ctx.db.query(
      `insert into usage_daily (user_id, day, messages) values ($1, (now() at time zone 'Europe/Istanbul')::date, 15)`,
      [g.user.id],
    );
    const r = await send(g, chat.id, { content: 'merhaba' });
    expect(r.status).toBe(429);
    expect(r.raw.json().error.code).toBe('quota_exceeded');
  });

  it('başka kullanıcının sohbetine erişilemez', async () => {
    const a = await member(env);
    const b = await member(env);
    const chat = await newChat(env.app, a);
    const r = await env.app.inject({ method: 'GET', url: `/api/chats/${chat.id}`, headers: auth(b) });
    expect(r.statusCode).toBe(404);
    const s = await send(b, chat.id, { content: 'hack' });
    expect(s.status).toBe(404);
  });

  it('aynı sohbette eşzamanlı üretim 409 verir', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.delayMs = 120;
    const first = send(m, chat.id, { content: 'bir' });
    await new Promise((r) => setTimeout(r, 60));
    const second = await send(m, chat.id, { content: 'iki' });
    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
  });
});

describe('katman kısıtları', () => {
  it('misafir: arama, sabitleme, ek dosya ve paylaşım kapalı', async () => {
    const g = await guest(env.app);
    const chat = await newChat(env.app, g);
    const search = await env.app.inject({ method: 'GET', url: '/api/chats?q=abc', headers: auth(g) });
    expect(search.statusCode).toBe(403);
    expect(search.json().error.code).toBe('tier_restricted');
    const pin = await env.app.inject({ method: 'PATCH', url: `/api/chats/${chat.id}`, headers: auth(g), payload: { pinned: true } });
    expect(pin.statusCode).toBe(403);
    const att = await send(g, chat.id, { content: 'oku', attachments: [{ name: 'a.txt', mime: 'text/plain', text: 'merhaba' }] });
    expect(att.status).toBe(403);
    const share = await env.app.inject({ method: 'POST', url: `/api/chats/${chat.id}/share`, headers: auth(g) });
    expect(share.statusCode).toBe(403);
  });

  it('misafir: en fazla 5 sohbet', async () => {
    const g = await guest(env.app);
    for (let i = 0; i < 5; i++) {
      const c = await newChat(env.app, g);
      await send(g, c.id, { content: `mesaj ${i}` });
    }
    const r = await env.app.inject({ method: 'POST', url: '/api/chats', headers: auth(g), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('tier_restricted');
  });

  it('misafir 4000+ karakterlik mesaj gönderemez', async () => {
    const g = await guest(env.app);
    const chat = await newChat(env.app, g);
    const r = await send(g, chat.id, { content: 'a'.repeat(4_001) });
    expect(r.status).toBe(400);
  });

  it('doğrulanmamış üye: hafıza ve ek dosya kapalı, özel talimat açık', async () => {
    const u = await member(env, { verify: false });
    const mem = await env.app.inject({ method: 'POST', url: '/api/memories', headers: auth(u), payload: { content: 'Kahveyi sever' } });
    expect(mem.statusCode).toBe(403);
    const patch = await env.app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(u),
      payload: { settings: { instructions: 'Kısa yaz.' } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().user.settings.instructions).toBe('Kısa yaz.');
  });
});

describe('üye özellikleri', () => {
  it('ek dosya içeriği modele gider', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    await send(m, chat.id, {
      content: 'Özetle',
      attachments: [{ name: 'notlar.md', mime: 'text/markdown', text: 'Toplantı salı günü.' }],
    });
    const last = env.ai.calls[0]!.messages.at(-1)!;
    expect(last.content).toContain('notlar.md');
    expect(last.content).toContain('Toplantı salı günü.');
  });

  it('özel talimat, hafıza ve rol sistem istemine eklenir', async () => {
    const m = await member(env);
    await env.app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(m),
      payload: { settings: { instructions: 'Her zaman madde işaretleriyle yaz.', about: 'Backend geliştiricisiyim.' } },
    });
    await env.app.inject({ method: 'POST', url: '/api/memories', headers: auth(m), payload: { content: 'Kullanıcı Kayseri\'de yaşıyor.' } });
    const chat = await newChat(env.app, m, { personaId: 'coder' });
    await send(m, chat.id, { content: 'Merhaba' });
    const sys = env.ai.calls[0]!.messages[0]!.content;
    expect(sys).toContain('Her zaman madde işaretleriyle yaz.');
    expect(sys).toContain('Backend geliştiricisiyim.');
    expect(sys).toContain('Kayseri');
    expect(sys).toContain('yazılım mühendisi');
  });

  it('"hatırla" ifadesi hafıza kaydı oluşturur', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.completeText = 'Kullanıcı vejetaryen.';
    const { events } = await send(m, chat.id, { content: 'Bunu hatırla: ben vejetaryenim.' });
    expect(events.some((e) => e.type === 'memory')).toBe(true);
    const list = await env.app.inject({ method: 'GET', url: '/api/memories', headers: auth(m) });
    expect(list.json().memories.map((x: { content: string }) => x.content)).toContain('Kullanıcı vejetaryen.');
  });

  it('sohbet arama, sabitleme, arşivleme ve silme', async () => {
    const m = await member(env);
    const a = await newChat(env.app, m);
    const b = await newChat(env.app, m);
    await send(m, a.id, { content: 'Python ile web scraping nasıl yapılır' });
    env.ai.completeText = 'Başka konu';
    await send(m, b.id, { content: 'Pasta tarifi ver' });

    const found = await env.app.inject({ method: 'GET', url: '/api/chats?q=scraping', headers: auth(m) });
    expect(found.json().chats).toHaveLength(1);
    expect(found.json().chats[0].snippet).toContain('scraping');

    const pin = await env.app.inject({ method: 'PATCH', url: `/api/chats/${b.id}`, headers: auth(m), payload: { pinned: true } });
    expect(pin.statusCode).toBe(200);
    const list = await env.app.inject({ method: 'GET', url: '/api/chats', headers: auth(m) });
    expect(list.json().chats[0].id).toBe(b.id);

    await env.app.inject({ method: 'PATCH', url: `/api/chats/${a.id}`, headers: auth(m), payload: { archived: true } });
    expect((await env.app.inject({ method: 'GET', url: '/api/chats', headers: auth(m) })).json().chats).toHaveLength(1);
    expect((await env.app.inject({ method: 'GET', url: '/api/chats?archived=true', headers: auth(m) })).json().chats).toHaveLength(1);

    const del = await env.app.inject({ method: 'DELETE', url: `/api/chats/${b.id}`, headers: auth(m) });
    expect(del.statusCode).toBe(204);
    expect((await env.app.inject({ method: 'GET', url: `/api/chats/${b.id}`, headers: auth(m) })).statusCode).toBe(404);
  });

  it('LIKE özel karakterleri aramada kaçırılır', async () => {
    const m = await member(env);
    const c = await newChat(env.app, m);
    await send(m, c.id, { content: 'yüzde %100 emin misin' });
    const r = await env.app.inject({ method: 'GET', url: '/api/chats?q=%25', headers: auth(m) });
    expect(r.json().chats).toHaveLength(1);
    const none = await env.app.inject({ method: 'GET', url: '/api/chats?q=_', headers: auth(m) });
    expect(none.json().chats).toHaveLength(0);
  });

  it('geri bildirim kaydedilir', async () => {
    const m = await member(env);
    const c = await newChat(env.app, m);
    await send(m, c.id, { content: 'selam' });
    const d = await detail(m, c.id);
    const asst = d.messages.find((x) => x.role === 'assistant')!;
    const r = await env.app.inject({ method: 'PUT', url: `/api/messages/${asst.id}/feedback`, headers: auth(m), payload: { value: 1 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().message.feedback).toBe(1);
  });

  it('paylaşım: herkese açık anlık görüntü, sonra iptal', async () => {
    const m = await member(env);
    const c = await newChat(env.app, m);
    await send(m, c.id, { content: 'paylaşılacak soru' });
    const sh = await env.app.inject({ method: 'POST', url: `/api/chats/${c.id}/share`, headers: auth(m) });
    expect(sh.statusCode).toBe(201);
    const slug = sh.json().slug as string;
    expect(sh.json().url).toMatch(new RegExp(`/s/${slug}$`));
    const pub = await env.app.inject({ method: 'GET', url: `/api/public/shares/${slug}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().messages.map((x: { role: string }) => x.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(pub.json())).not.toContain('Düşünüyorum'); // akıl yürütme paylaşılmaz
    await env.app.inject({ method: 'DELETE', url: `/api/chats/${c.id}/share`, headers: auth(m) });
    expect((await env.app.inject({ method: 'GET', url: `/api/public/shares/${slug}` })).statusCode).toBe(404);
  });

  it('dışa aktarma tüm sohbetleri döner', async () => {
    const m = await member(env);
    const c = await newChat(env.app, m);
    await send(m, c.id, { content: 'selam' });
    const r = await env.app.inject({ method: 'GET', url: '/api/me/export', headers: auth(m) });
    expect(r.statusCode).toBe(200);
    expect(r.json().chats).toHaveLength(1);
    expect(r.json().chats[0].messages).toHaveLength(2);
  });
});
