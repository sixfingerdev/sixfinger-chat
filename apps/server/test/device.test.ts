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

const start = () => env.app.inject({ method: 'POST', url: '/api/device/start', payload: { client: 'SixFinger Code CLI' } });
const poll = (deviceCode: string) => env.app.inject({ method: 'POST', url: '/api/device/poll', payload: { deviceCode } });

describe('cihaz girişi', () => {
  it('başlat → bekle → onayla → jeton al (tek kullanımlık)', async () => {
    const s = (await start()).json();
    expect(s.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(s.verificationUrl).toContain(`/device?code=${s.userCode}`);
    expect((await poll(s.deviceCode)).json()).toEqual({ status: 'pending' });

    const a = await member(env);
    const info = await env.app.inject({ method: 'POST', url: '/api/device/info', headers: auth(a), payload: { userCode: s.userCode.toLowerCase() } });
    expect(info.json()).toEqual({ client: 'SixFinger Code CLI' });
    const ok = await env.app.inject({ method: 'POST', url: '/api/device/approve', headers: auth(a), payload: { userCode: s.userCode } });
    expect(ok.statusCode).toBe(200);

    const got = (await poll(s.deviceCode)).json();
    expect(got.status).toBe('approved');
    expect(got.accessToken).toBeTruthy();
    expect(got.refreshToken).toMatch(/^sfr_/);
    expect(got.user.id).toBe(a.user.id);
    // aynı kodla ikinci jeton alınamaz
    expect((await poll(s.deviceCode)).statusCode).toBe(410);
  });

  it('onaylanmamış kodla jeton verilmez; bilinmeyen kod 410', async () => {
    const s = (await start()).json();
    expect((await poll(s.deviceCode)).json().status).toBe('pending');
    expect((await poll('sfd_' + 'x'.repeat(40))).statusCode).toBe(410);
  });

  it('süresi dolan kod onaylanamaz ve jeton vermez', async () => {
    const s = (await start()).json();
    await env.ctx.db.query(`update device_auth set expires_at = now() - interval '1 second'`);
    const a = await member(env);
    const r = await env.app.inject({ method: 'POST', url: '/api/device/approve', headers: auth(a), payload: { userCode: s.userCode } });
    expect(r.statusCode).toBe(404);
    expect((await poll(s.deviceCode)).statusCode).toBe(410);
  });

  it('misafir onaylayamaz, oturumsuz erişemez', async () => {
    const s = (await start()).json();
    const g = await guest(env.app);
    expect((await env.app.inject({ method: 'POST', url: '/api/device/approve', headers: auth(g), payload: { userCode: s.userCode } })).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: '/api/device/approve', payload: { userCode: s.userCode } })).statusCode).toBe(401);
  });
});
