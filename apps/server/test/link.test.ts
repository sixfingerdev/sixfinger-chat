import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, guest, member, resetDb, setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb(env.ctx);
});

const coder = (email = 'coder@example.com') => member(env, { email });
type A = Awaited<ReturnType<typeof coder>>;
const call = (a: A, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) => env.app.inject({ method, url: `/api${url}`, headers: auth(a), payload });

async function device(a: A, name = 'laptop') {
  return (await call(a, 'POST', '/link/register', { name, platform: 'linux', version: '1.0.0' })).json().deviceId as string;
}
const sync = (a: A, deviceId: string, body: object = {}) => call(a, 'POST', '/link/sync', { deviceId, ...body });
const poll = (a: A, deviceId: string, body: object = {}) => call(a, 'POST', '/link/poll', { deviceId, ...body });
const msgs = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'merhaba' }] }];

describe('uzaktan CLI köprüsü', () => {
  it('cihaz kaydı tekrarlanınca aynı kimliği verir', async () => {
    const a = await coder();
    expect(await device(a)).toBe(await device(a));
    expect((await call(a, 'GET', '/link/devices')).json().devices).toMatchObject([{ name: 'laptop', online: true, sessions: 0 }]);
  });

  it('eşitleme oturumları kaydeder; liste ve ayrıntıda görünür', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 'ses_1', title: 'Hata ayıkla', directory: '/p', status: 'busy', snapshot: msgs, pending: [{ kind: 'permission', requestId: 'p1' }] }] });
    const list = (await call(a, 'GET', '/link/sessions')).json().sessions;
    expect(list).toMatchObject([{ id: 'ses_1', title: 'Hata ayıkla', deviceName: 'laptop', status: 'busy', online: true }]);
    const one = (await call(a, 'GET', `/link/sessions/${id}/ses_1`)).json();
    expect(one.messages).toEqual(msgs);
    expect(one.pending).toHaveLength(1);
    // anlık görüntü gönderilmezse eskisi korunur
    await sync(a, id, { sessions: [{ id: 'ses_1', title: 'Yeni ad', status: 'idle' }] });
    const two = (await call(a, 'GET', `/link/sessions/${id}/ses_1`)).json();
    expect(two.messages).toEqual(msgs);
    expect(two.session.title).toBe('Yeni ad');
    await sync(a, id, { gone: ['ses_1'] });
    expect((await call(a, 'GET', '/link/sessions')).json().sessions).toHaveLength(0);
  });

  it('komutlar kuyruğa girer, cihaz eşitlemede alır ve bir kez teslim edilir', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's', status: 'idle' }] });
    expect((await call(a, 'POST', `/link/sessions/${id}/s/prompt`, { text: 'testleri çalıştır' })).statusCode).toBe(200);
    expect((await call(a, 'POST', `/link/sessions/${id}/s/abort`)).statusCode).toBe(200);
    expect((await call(a, 'POST', `/link/sessions/${id}/s/permission`, { requestId: 'p1', reply: 'once' })).statusCode).toBe(200);
    const got = (await sync(a, id)).json().commands;
    expect(got.map((c: { kind: string }) => c.kind)).toEqual(['prompt', 'abort', 'permission']);
    expect(got[0]).toMatchObject({ sessionId: 's', payload: { text: 'testleri çalıştır' } });
    expect((await sync(a, id)).json().commands).toEqual([]);
  });

  it('eski komut çalıştırılmaz', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    await call(a, 'POST', `/link/sessions/${id}/s/prompt`, { text: 'x' });
    await env.ctx.db.query(`update link_commands set created_at = now() - interval '10 minutes'`);
    expect((await sync(a, id)).json().commands).toEqual([]);
  });

  it('çevrimdışı cihaza komut kabul edilmez', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    await env.ctx.db.query(`update linked_devices set last_seen = now() - interval '5 minutes'`);
    expect((await call(a, 'POST', `/link/sessions/${id}/s/prompt`, { text: 'x' })).statusCode).toBe(409);
    expect((await call(a, 'GET', '/link/devices')).json().devices[0].online).toBe(false);
  });

  it('başkasının cihazına ve oturumuna erişilemez', async () => {
    const a = await coder();
    const b = await coder('second@example.com');
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    expect((await sync(b, id)).statusCode).toBe(404);
    expect((await call(b, 'GET', `/link/sessions/${id}/s`)).statusCode).toBe(404);
    expect((await call(b, 'POST', `/link/sessions/${id}/s/prompt`, { text: 'x' })).statusCode).toBe(404);
    expect((await call(b, 'DELETE', `/link/devices/${id}`)).statusCode).toBe(404);
    expect((await call(b, 'GET', '/link/sessions')).json().sessions).toEqual([]);
  });

  it('cihazı silince oturumları ve komutları da gider', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    expect((await call(a, 'DELETE', `/link/devices/${id}`)).statusCode).toBe(204);
    expect((await call(a, 'GET', '/link/sessions')).json().sessions).toEqual([]);
  });

  it('misafir ve izinsiz üye kullanamaz', async () => {
    const g = await guest(env.app);
    expect((await call(g, 'GET', '/link/devices')).statusCode).toBeGreaterThanOrEqual(401);
    const m = await member(env);
    expect((await call(m, 'GET', '/link/devices')).statusCode).toBe(403);
  });

  it('uzun yoklama komut gelince hemen döner', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    const t0 = Date.now();
    const waiting = poll(a, id, { wait: 10 });
    await new Promise((r) => setTimeout(r, 300));
    await call(a, 'POST', `/link/sessions/${id}/s/prompt`, { text: 'merhaba' });
    const r = (await waiting).json();
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).toMatchObject({ kind: 'prompt', sessionId: 's', attempt: 1 });
  });

  it('boş uzun yoklama süre dolunca boş döner ve cihazı canlı tutar', async () => {
    const a = await coder();
    const id = await device(a);
    const r = await poll(a, id, { wait: 1 });
    expect(r.json().commands).toEqual([]);
    expect((await call(a, 'GET', '/link/devices')).json().devices[0].online).toBe(true);
  });

  it('onaylanmayan komut yeniden teslim edilir, onaylanan edilmez; ack durumu yansır', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    const cmdId = (await call(a, 'POST', `/link/sessions/${id}/s/prompt`, { text: 'x' })).json().commandId;
    expect((await poll(a, id)).json().commands).toHaveLength(1);
    expect((await poll(a, id)).json().commands).toHaveLength(0); // henüz bekleme süresi dolmadı
    await env.ctx.db.query(`update link_commands set sent_at = now() - interval '20 seconds'`);
    const again = (await poll(a, id)).json().commands;
    expect(again).toHaveLength(1);
    expect(again[0].attempt).toBe(2);
    await poll(a, id, { acks: [{ id: cmdId, ok: true }] });
    await env.ctx.db.query(`update link_commands set sent_at = now() - interval '20 seconds'`);
    expect((await poll(a, id)).json().commands).toHaveLength(0);
    const st = (await call(a, 'GET', `/link/commands/${cmdId}`)).json();
    expect(st.status).toBe('done');
    const d = (await call(a, 'GET', `/link/sessions/${id}/s`)).json();
    expect(d.commands[0]).toMatchObject({ id: cmdId, kind: 'prompt', status: 'done' });
  });

  it('3 denemeden sonra onaylanmayan komut failed olur', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    const cmdId = (await call(a, 'POST', `/link/sessions/${id}/s/abort`)).json().commandId;
    for (let i = 0; i < 3; i++) {
      expect((await poll(a, id)).json().commands).toHaveLength(1);
      await env.ctx.db.query(`update link_commands set sent_at = now() - interval '20 seconds'`);
    }
    expect((await poll(a, id)).json().commands).toHaveLength(0);
    expect((await call(a, 'GET', `/link/commands/${cmdId}`)).json()).toMatchObject({ status: 'failed', result: { error: 'cihaz onaylamadı' } });
  });

  it('başarısız ack hata metniyle görünür', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    const cmdId = (await call(a, 'POST', `/link/sessions/${id}/s/prompt`, { text: 'x' })).json().commandId;
    await poll(a, id);
    await poll(a, id, { acks: [{ id: cmdId, ok: false, error: 'desteklenmeyen komut' }] });
    const d = (await call(a, 'GET', `/link/sessions/${id}/s`)).json();
    expect(d.commands[0]).toMatchObject({ status: 'failed', error: 'desteklenmeyen komut' });
  });

  it('sunucunun tanımadığı komut türü iletilir; biçim bozuksa reddedilir', async () => {
    const a = await coder();
    const id = await device(a);
    const ok = await call(a, 'POST', `/link/devices/${id}/commands`, { kind: 'new_session', payload: { directory: '/p', text: 'başla' } });
    expect(ok.statusCode).toBe(200);
    const cmds = (await poll(a, id)).json().commands;
    expect(cmds[0]).toMatchObject({ kind: 'new_session', sessionId: '', payload: { directory: '/p', text: 'başla' } });
    expect((await call(a, 'POST', `/link/devices/${id}/commands`, { kind: 'Bad Kind!', payload: {} })).statusCode).toBe(400);
    expect((await call(a, 'POST', `/link/devices/${id}/commands`, { kind: 'x', sessionId: 'yok', payload: {} })).statusCode).toBe(404);
  });

  it('aynı idempotency anahtarı tek komut üretir', async () => {
    const a = await coder();
    const id = await device(a);
    await sync(a, id, { sessions: [{ id: 's' }] });
    const post = () => env.app.inject({ method: 'POST', url: `/api/link/sessions/${id}/s/prompt`, headers: { ...auth(a), 'x-idempotency-key': 'k1' }, payload: { text: 'x' } });
    const [r1, r2] = [(await post()).json(), (await post()).json()];
    expect(r1.commandId).toBe(r2.commandId);
    expect((await poll(a, id)).json().commands).toHaveLength(1);
  });

  it('cihaz yeteneklerini ve protokolünü bildirir', async () => {
    const a = await coder();
    await call(a, 'POST', '/link/register', { name: 'pc', protocol: 1, capabilities: ['prompt', 'new_session'] });
    expect((await call(a, 'GET', '/link/devices')).json().devices[0]).toMatchObject({ protocol: 1, capabilities: ['prompt', 'new_session'] });
    expect((await call(a, 'POST', '/link/register', { name: 'old', protocol: 0 })).statusCode).toBe(426);
  });
});
