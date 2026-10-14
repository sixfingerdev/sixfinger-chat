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
  env.mails.length = 0;
});

describe('auth', () => {
  it('misafir hesabı oluşturur ve /me ile okunur', async () => {
    const g = await guest(env.app);
    expect(g.user.isGuest).toBe(true);
    expect(g.user.tier).toBe('guest');
    const me = await env.app.inject({ method: 'GET', url: '/api/me', headers: auth(g) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(g.user.id);
  });

  it('token olmadan 401 döner', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('unauthorized');
  });

  it('kayıt, e-posta doğrulama ve katman yükselmesi', async () => {
    const s = await member(env, { verify: false, email: 'ada@example.com' });
    expect(s.user.tier).toBe('unverified');
    await new Promise((r) => setTimeout(r, 20));
    expect(env.mails).toHaveLength(1);
    expect(env.mails[0]!.to).toBe('ada@example.com');

    const bad = await env.app.inject({ method: 'POST', url: '/api/auth/verify', headers: auth(s), payload: { code: '000000' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_code');

    const ok = await env.app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      headers: auth(s),
      payload: { code: env.mails[0]!.code },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.tier).toBe('member');
  });

  it('aynı e-posta ile ikinci kayıt 409 döner (büyük/küçük harf duyarsız)', async () => {
    await member(env, { email: 'dup@example.com' });
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'DUP@example.com', password: 'another-password' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('email_taken');
  });

  it('misafir hesabı kayıtla yükseltilir ve sohbetleri korunur', async () => {
    const g = await guest(env.app);
    const c = await env.app.inject({ method: 'POST', url: '/api/chats', headers: auth(g), payload: {} });
    expect(c.statusCode).toBe(201);
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: auth(g),
      payload: { email: 'upgrade@example.com', password: 'a-good-password' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.id).toBe(g.user.id);
    expect(r.json().user.isGuest).toBe(false);
    // eski misafir oturumu kapandı
    const old = await env.app.inject({ method: 'GET', url: '/api/me', headers: auth(g) });
    expect(old.statusCode).toBe(401);
  });

  it('giriş: doğru şifre çalışır, yanlış şifre ve olmayan kullanıcı aynı hatayı verir', async () => {
    await member(env, { email: 'login@example.com' });
    const ok = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'Login@Example.com', password: 'correct-horse-battery' },
    });
    expect(ok.statusCode).toBe(200);
    const wrong = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@example.com', password: 'nope-nope-nope' },
    });
    const missing = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@example.com', password: 'nope-nope-nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(missing.json().error.message);
  });

  it('refresh token döner, eski token kısa süre tolerans görür, sonra oturum kapanır', async () => {
    const s = await member(env);
    const r1 = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: s.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const next = r1.json();
    expect(next.refreshToken).not.toBe(s.refreshToken);

    // eski token tolerans süresinde hâlâ kabul edilir (iki sekme senaryosu)
    const grace = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: s.refreshToken } });
    expect(grace.statusCode).toBe(200);

    // tolerans bittikten sonra eski token yeniden kullanılırsa oturum iptal edilir
    await env.ctx.db.query(`update refresh_tokens set prev_valid_until = now() - interval '1 second'`);
    const reuse = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: next.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const afterRevoke = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: grace.json().refreshToken } });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('çıkış refresh token\'ı iptal eder', async () => {
    const s = await member(env);
    const out = await env.app.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken: s.refreshToken } });
    expect(out.statusCode).toBe(204);
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: s.refreshToken } });
    expect(r.statusCode).toBe(401);
    const me = await env.app.inject({ method: 'GET', url: '/api/me', headers: auth(s) });
    expect(me.statusCode).toBe(401);
  });

  it('şifre sıfırlama: kod ile yeni şifre, eski oturumlar kapanır', async () => {
    const s = await member(env, { email: 'reset@example.com' });
    env.mails.length = 0;
    // doğrulama kodunun bekleme süresini aş
    await env.ctx.db.query(`update email_codes set created_at = now() - interval '5 minutes'`);
    const f = await env.app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: 'reset@example.com' } });
    expect(f.statusCode).toBe(204);
    expect(env.mails.at(-1)?.purpose).toBe('reset');
    const code = env.mails.at(-1)!.code;

    const bad = await env.app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { email: 'reset@example.com', code: '111111', password: 'brand-new-password' },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await env.app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { email: 'reset@example.com', code, password: 'brand-new-password' },
    });
    expect(ok.statusCode).toBe(204);
    expect((await env.app.inject({ method: 'GET', url: '/api/me', headers: auth(s) })).statusCode).toBe(401);
    const login = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'reset@example.com', password: 'brand-new-password' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('olmayan hesap için /forgot yine 204 döner ve e-posta göndermez', async () => {
    const f = await env.app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: 'nobody@example.com' } });
    expect(f.statusCode).toBe(204);
    expect(env.mails).toHaveLength(0);
  });

  it('zayıf/geçersiz girdiler 400 döner', async () => {
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'not-an-email', password: 'short' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('bad_request');
  });

  it('hesap silme tüm veriyi kaldırır', async () => {
    const s = await member(env, { email: 'bye@example.com' });
    const del = await env.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: auth(s),
      payload: { password: 'correct-horse-battery' },
    });
    expect(del.statusCode).toBe(204);
    const row = await env.ctx.db.query('select 1 from users where lower(email) = $1', ['bye@example.com']);
    expect(row.rowCount).toBe(0);
  });
});
