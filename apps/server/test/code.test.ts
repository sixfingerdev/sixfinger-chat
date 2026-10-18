import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creditsFor, diskMultiplier, pickCodeGreeting } from '@sixfinger/shared';
import { loadConfig } from '../src/config.ts';
import { createGithub } from '../src/services/github.ts';
import { createSecretBox } from '../src/lib/secretbox.ts';
import { auth, guest, member, resetDb, setup, type TestEnv } from './helpers.ts';

/** Sahte GitHub: gerçek createGithub koduna sahte fetch verilir. */
function fakeGithubFetch() {
  const calls: Array<{ url: string; auth: string | null; method: string; body?: string }> = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, auth: headers.authorization ?? null, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(String(init?.body));
      return body.code === 'good-code' ? json({ access_token: 'gho_secrettoken', scope: 'repo,read:user' }) : json({ error: 'bad_verification_code' });
    }
    if (headers.authorization !== 'Bearer gho_secrettoken' && !url.includes('/applications/')) return json({ message: 'Bad credentials' }, 401);
    if (url === 'https://api.github.com/user') return json({ id: 42, login: 'octo', avatar_url: 'https://a/b.png' });
    if (url.startsWith('https://api.github.com/user/repos')) {
      return json([
        { full_name: 'octo/alpha', private: false, default_branch: 'main', description: 'Birinci', pushed_at: '2026-10-01T00:00:00Z' },
        { full_name: 'octo/beta-secret', private: true, default_branch: 'dev', description: 'Gizli proje', pushed_at: null },
        { full_name: 'octo/old', private: false, default_branch: 'main', description: '', pushed_at: null, archived: true },
      ]);
    }
    if (url === 'https://api.github.com/repos/octo/alpha') return json({ default_branch: 'main' });
    if (url.startsWith('https://api.github.com/repos/octo/alpha/branches')) return json([{ name: 'feature' }, { name: 'main' }]);
    if (url.includes('/applications/')) return new Response(null, { status: 204 });
    return json({ message: 'Not Found' }, 404);
  };
  return { f, calls };
}

let env: TestEnv;
let gh: ReturnType<typeof fakeGithubFetch>;

beforeAll(async () => {
  gh = fakeGithubFetch();
  env = await setup([], {}, { github: createGithub(loadConfig(), gh.f) });
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb(env.ctx);
  gh.calls.length = 0;
});

const coder = () => member(env, { email: 'coder@example.com' });

/** OAuth akışı: start → (GitHub) → callback → istemcide complete. */
async function connect(a: Awaited<ReturnType<typeof coder>>, target: 'web' | 'app' = 'web') {
  const start = await env.app.inject({ method: 'POST', url: '/api/code/github/start', headers: auth(a), payload: { target } });
  expect(start.statusCode).toBe(200);
  const url = new URL(start.json().url);
  const state = url.searchParams.get('state')!;
  const cb = await env.app.inject({ method: 'GET', url: `/api/code/github/callback?code=good-code&state=${encodeURIComponent(state)}` });
  // Geri dönüş kodu istemciye taşır; bağlantıyı istemci kendi oturumuyla tamamlar.
  const loc = cb.headers.location ? new URL(String(cb.headers.location)) : new URL(/href="([^"]+)"/.exec(cb.body)![1]!.replaceAll('&amp;', '&'));
  const code = loc.searchParams.get('gh_code');
  const st = loc.searchParams.get('gh_state');
  const complete = code && st ? await env.app.inject({ method: 'POST', url: '/api/code/github/complete', headers: auth(a), payload: { code, state: st } }) : null;
  return { start: url, cb, loc, complete, state };
}

describe('erişim', () => {
  it('izin listesinde olmayan üye Code kullanamaz, durum ucu allowed:false döner', async () => {
    const a = await member(env);
    const st = await env.app.inject({ method: 'GET', url: '/api/code/status', headers: auth(a) });
    expect(st.statusCode).toBe(200);
    expect(st.json()).toMatchObject({ available: true, allowed: false, github: null });
    const r = await env.app.inject({ method: 'GET', url: '/api/code/sessions', headers: auth(a) });
    expect(r.statusCode).toBe(403);
  });

  it('misafir ve doğrulanmamış hesap Code kullanamaz', async () => {
    const g = await guest(env.app);
    expect((await env.app.inject({ method: 'GET', url: '/api/code/environments', headers: auth(g) })).statusCode).toBe(403);
    const u = await member(env, { email: 'coder@example.com', verify: false });
    expect((await env.app.inject({ method: 'GET', url: '/api/code/environments', headers: auth(u) })).statusCode).toBe(403);
  });

  it('oturum açmadan 401', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/code/status' })).statusCode).toBe(401);
  });

  it('/config Code izni bilgisini içerir', async () => {
    const a = await coder();
    const r = await env.app.inject({ method: 'GET', url: '/api/config', headers: auth(a) });
    expect(r.json().code).toEqual({ allowed: true });
  });
});

describe('GitHub OAuth', () => {
  it('yetkilendirme adresi doğru istemci, kapsam ve imzalı state taşır', async () => {
    const a = await coder();
    const { start } = await connect(a);
    expect(start.origin + start.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(start.searchParams.get('client_id')).toBe('test-client-id');
    expect(start.searchParams.get('scope')).toBe('repo read:user');
    expect(start.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/code/github/callback');
  });

  it('web: geri dönüş kodu uygulamaya taşır, bağlantıyı istemci tamamlar; token şifreli saklanır', async () => {
    const a = await coder();
    const { cb, complete, loc } = await connect(a);
    expect(cb.statusCode).toBe(302);
    expect(loc.origin + loc.pathname).toBe('http://localhost:5173/code');
    // Geri dönüş tek başına hesabı bağlamaz.
    expect((await env.ctx.db.query('select 1 from github_connections')).rowCount).toBe(1);
    expect(complete!.statusCode).toBe(200);
    expect(complete!.json().github).toEqual({ login: 'octo', avatarUrl: 'https://a/b.png' });
    const st = await env.app.inject({ method: 'GET', url: '/api/code/status', headers: auth(a) });
    expect(st.json().github).toEqual({ login: 'octo', avatarUrl: 'https://a/b.png' });
    const row = await env.ctx.db.query<{ token_enc: string }>('select token_enc from github_connections');
    expect(row.rows[0]!.token_enc).not.toContain('gho_secrettoken');
    expect(JSON.stringify(st.json())).not.toContain('gho_secrettoken');
  });

  it('geri dönüş oturumsuz çağrıldığında hesap bağlamaz', async () => {
    const a = await coder();
    const start = await env.app.inject({ method: 'POST', url: '/api/code/github/start', headers: auth(a), payload: {} });
    const state = new URL(start.json().url).searchParams.get('state')!;
    const cb = await env.app.inject({ method: 'GET', url: `/api/code/github/callback?code=good-code&state=${encodeURIComponent(state)}` });
    expect(cb.statusCode).toBe(302);
    expect((await env.ctx.db.query('select 1 from github_connections')).rowCount).toBe(0);
    expect((await env.app.inject({ method: 'GET', url: '/api/code/status', headers: auth(a) })).json().github).toBeNull();
  });

  it('SALDIRI: başkasının başlattığı akış, kurbanın oturumuyla tamamlanamaz (hesap bağlama CSRF)', async () => {
    const attacker = await coder();
    env.ctx.config.codeAllowed.emails.add('victim@example.com'); // kurban da Code kullanabilen biri: engel izin değil, kullanıcı eşleşmesi olmalı
    const victim = await member(env, { email: 'victim@example.com' });
    // Saldırgan akışı başlatıp URL'yi kurbana yollar; kurban GitHub'da onaylar, geri dönüş kurbanın tarayıcısında çalışır.
    const start = await env.app.inject({ method: 'POST', url: '/api/code/github/start', headers: auth(attacker), payload: {} });
    const state = new URL(start.json().url).searchParams.get('state')!;
    const cb = await env.app.inject({ method: 'GET', url: `/api/code/github/callback?code=good-code&state=${encodeURIComponent(state)}` });
    const loc = new URL(String(cb.headers.location));
    // Kurbanın SixFinger oturumu (varsa) ile tamamlama denemesi state'teki kullanıcıyla eşleşmediği için reddedilir...
    const asVictim = await env.app.inject({
      method: 'POST', url: '/api/code/github/complete', headers: auth(victim),
      payload: { code: loc.searchParams.get('gh_code'), state: loc.searchParams.get('gh_state') },
    });
    expect(asVictim.statusCode).toBe(400);
    // ...ve oturumsuz tamamlama da olmaz.
    const anon = await env.app.inject({ method: 'POST', url: '/api/code/github/complete', payload: { code: 'x', state } });
    expect(anon.statusCode).toBe(401);
    expect((await env.ctx.db.query('select 1 from github_connections')).rowCount).toBe(0);
  });

  it('mobil: özel şemalı bağlantıda kod ve state taşınır (HTML güvenli kaçışlı)', async () => {
    const a = await coder();
    const { cb, complete } = await connect(a, 'app');
    expect(cb.statusCode).toBe(200);
    expect(cb.body).toContain('sixfinger://code?gh_code=good-code&amp;gh_state=');
    expect(cb.headers['referrer-policy']).toBe('no-referrer');
    expect(complete!.statusCode).toBe(200);
  });

  it('sahte ya da bozuk state reddedilir, hatalı kod bağlantı kurmaz, süresi dolan state geçersizdir', async () => {
    const a = await coder();
    const bad = await env.app.inject({ method: 'GET', url: '/api/code/github/callback?code=good-code&state=abc.def' });
    expect(bad.statusCode).toBe(400);
    const start = await env.app.inject({ method: 'POST', url: '/api/code/github/start', headers: auth(a), payload: {} });
    const state = new URL(start.json().url).searchParams.get('state')!;
    const denied = await env.app.inject({ method: 'GET', url: `/api/code/github/callback?error=access_denied&state=${encodeURIComponent(state)}` });
    expect(denied.headers.location).toBe('http://localhost:5173/code?github=error');
    // GitHub kodu reddederse tamamlama 400 döner ve bağlantı kurulmaz.
    const wrong = await env.app.inject({ method: 'POST', url: '/api/code/github/complete', headers: auth(a), payload: { code: 'wrong', state } });
    expect(wrong.statusCode).toBe(400);
    const expired = env.ctx.secrets!.signState({ u: a.user.id, t: 'web' }, -1);
    const exp = await env.app.inject({ method: 'POST', url: '/api/code/github/complete', headers: auth(a), payload: { code: 'good-code', state: expired } });
    expect(exp.statusCode).toBe(400);
    expect((await env.app.inject({ method: 'GET', url: '/api/code/status', headers: auth(a) })).json().github).toBeNull();
  });

  it('bağlantıyı kesince kayıt silinir ve GitHub yetkisi iptal edilir', async () => {
    const a = await coder();
    await connect(a);
    const del = await env.app.inject({ method: 'DELETE', url: '/api/code/github', headers: auth(a) });
    expect(del.statusCode).toBe(204);
    expect((await env.ctx.db.query('select 1 from github_connections')).rowCount).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(gh.calls.some((c) => c.method === 'DELETE' && c.url.includes('/applications/test-client-id/grant'))).toBe(true);
  });

  it('bağlı değilken repo listesi 409 github_required', async () => {
    const a = await coder();
    const r = await env.app.inject({ method: 'GET', url: '/api/code/repos', headers: auth(a) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('github_required');
  });

  it('repo listesi arşivlenmişleri atar, aramaya göre süzer', async () => {
    const a = await coder();
    await connect(a);
    const all = await env.app.inject({ method: 'GET', url: '/api/code/repos', headers: auth(a) });
    expect(all.json().repos.map((r: { fullName: string }) => r.fullName)).toEqual(['octo/alpha', 'octo/beta-secret']);
    const q = await env.app.inject({ method: 'GET', url: '/api/code/repos?q=gizli', headers: auth(a) });
    expect(q.json().repos.map((r: { fullName: string }) => r.fullName)).toEqual(['octo/beta-secret']);
  });

  it('branch listesi varsayılan branch ile başlar', async () => {
    const a = await coder();
    await connect(a);
    const r = await env.app.inject({ method: 'GET', url: '/api/code/branches?repo=octo/alpha', headers: auth(a) });
    expect(r.json()).toEqual({ defaultBranch: 'main', branches: ['main', 'feature'] });
    for (const bad of ['..%2Fuser', '.%2F..', 'a%2Fb%2Fc', 'a%20b%2Fc'])
      expect((await env.app.inject({ method: 'GET', url: `/api/code/branches?repo=${bad}`, headers: auth(a) })).statusCode).toBe(400);
    const before = gh.calls.length;
    await env.app.inject({ method: 'GET', url: '/api/code/branches?repo=..%2Fuser', headers: auth(a) });
    expect(gh.calls.length).toBe(before);
  });
});

describe('ortamlar', () => {
  it('ilk listede hazır "Default" ortamı oluşur', async () => {
    const a = await coder();
    const r = await env.app.inject({ method: 'GET', url: '/api/code/environments', headers: auth(a) });
    expect(r.json().environments).toHaveLength(1);
    expect(r.json().environments[0]).toMatchObject({ name: 'Default', network: 'trusted', diskMb: 512 });
  });

  it('oluşturma, okuma (değişkenlerle), güncelleme, silme; değişkenler şifreli saklanır, listede dönmez', async () => {
    const a = await coder();
    const c = await env.app.inject({
      method: 'POST',
      url: '/api/code/environments',
      headers: auth(a),
      payload: { name: 'Node', network: 'custom', allowedDomains: ['registry.npmjs.org', '*.github.com'], setupScript: 'npm ci', diskMb: 1024, envVars: { API_KEY: 'sir-deger' } },
    });
    expect(c.statusCode).toBe(201);
    const e = c.json().environment;
    expect(e).toMatchObject({ name: 'Node', network: 'custom', diskMb: 1024, envVarCount: 1, envVars: { API_KEY: 'sir-deger' } });
    const raw = await env.ctx.db.query<{ env_vars_enc: string }>('select env_vars_enc from code_environments where id = $1', [e.id]);
    expect(raw.rows[0]!.env_vars_enc).not.toContain('sir-deger');
    const list = await env.app.inject({ method: 'GET', url: '/api/code/environments', headers: auth(a) });
    expect(JSON.stringify(list.json())).not.toContain('sir-deger');
    const u = await env.app.inject({ method: 'PATCH', url: `/api/code/environments/${e.id}`, headers: auth(a), payload: { diskMb: 1536, envVars: {} } });
    expect(u.json().environment).toMatchObject({ diskMb: 1536, envVarCount: 0, name: 'Node' });
    expect((await env.app.inject({ method: 'DELETE', url: `/api/code/environments/${e.id}`, headers: auth(a) })).statusCode).toBe(204);
    expect((await env.app.inject({ method: 'GET', url: `/api/code/environments/${e.id}`, headers: auth(a) })).statusCode).toBe(404);
  });

  it('disk 128–1536 MB dışında, geçersiz alan adı, ayrılmış değişken adı reddedilir', async () => {
    const a = await coder();
    const post = (payload: object) => env.app.inject({ method: 'POST', url: '/api/code/environments', headers: auth(a), payload });
    expect((await post({ name: 'a', diskMb: 100 })).statusCode).toBe(400);
    expect((await post({ name: 'a', diskMb: 2000 })).statusCode).toBe(400);
    expect((await post({ name: 'a', network: 'custom', allowedDomains: ['not a domain'] })).statusCode).toBe(400);
    expect((await post({ name: 'a', envVars: { LD_PRELOAD: 'x' } })).statusCode).toBe(400);
    expect((await post({ name: 'a', envVars: { HTTPS_PROXY: 'x' } })).statusCode).toBe(400);
    expect((await post({ name: 'a', envVars: { '1BAD': 'x' } })).statusCode).toBe(400);
    expect((await post({ name: 'a', diskMb: 1536 })).statusCode).toBe(201);
  });

  it('aynı isim 409, başkasının ortamı 404', async () => {
    const a = await coder();
    const body = { name: 'Aynı' };
    await env.app.inject({ method: 'POST', url: '/api/code/environments', headers: auth(a), payload: body });
    expect((await env.app.inject({ method: 'POST', url: '/api/code/environments', headers: auth(a), payload: { name: 'aynı' } })).statusCode).toBe(409);
    const list = await env.app.inject({ method: 'GET', url: '/api/code/environments', headers: auth(a) });
    const id = list.json().environments[0].id;
    await env.ctx.db.query(`update users set email_verified_at = now() where email = 'coder@example.com'`);
    // Başka kullanıcı (izin listesi herkese açık değilken) zaten erişemez; sahiplik ayrıca sorguda kontrol edilir.
    const other = await env.ctx.db.query<{ id: string }>(`insert into users (email, display_name, email_verified_at) values ('x@example.com', 'x', now()) returning id`);
    const r = await env.ctx.code.getEnvironment(other.rows[0]!.id, id).catch((e) => e);
    expect(r.status).toBe(404);
  });
});

describe('oturumlar', () => {
  async function prepared() {
    const a = await coder();
    await connect(a);
    return a;
  }

  it('oturum oluşturunca code türünde sohbet açılır; sohbet listesinde görünmez', async () => {
    const a = await prepared();
    const r = await env.app.inject({ method: 'POST', url: '/api/code/sessions', headers: auth(a), payload: { repo: 'octo/alpha', baseBranch: 'main' } });
    expect(r.statusCode).toBe(201);
    const s = r.json().session;
    expect(s).toMatchObject({ repo: 'octo/alpha', baseBranch: 'main', status: 'idle', environmentName: 'Default', title: 'Yeni oturum' });
    expect(s.workBranch).toMatch(/^sixfinger\/alpha-[0-9a-f]{6}$/);
    const chat = await env.app.inject({ method: 'GET', url: `/api/chats/${s.chatId}`, headers: auth(a) });
    expect(chat.json().chat.kind).toBe('code');
    const list = await env.app.inject({ method: 'GET', url: '/api/chats', headers: auth(a) });
    expect(list.json().chats).toEqual([]);
    const sessions = await env.app.inject({ method: 'GET', url: '/api/code/sessions', headers: auth(a) });
    expect(sessions.json().sessions.map((x: { chatId: string }) => x.chatId)).toEqual([s.chatId]);
  });

  it('olmayan branch ya da bağlantısız hesap reddedilir', async () => {
    const a = await prepared();
    const r = await env.app.inject({ method: 'POST', url: '/api/code/sessions', headers: auth(a), payload: { repo: 'octo/alpha', baseBranch: 'yok' } });
    expect(r.statusCode).toBe(400);
    await env.app.inject({ method: 'DELETE', url: '/api/code/github', headers: auth(a) });
    const r2 = await env.app.inject({ method: 'POST', url: '/api/code/sessions', headers: auth(a), payload: { repo: 'octo/alpha', baseBranch: 'main' } });
    expect(r2.statusCode).toBe(409);
  });

  it('Code oturumunda henüz mesaj gönderilemez; tüm sohbetleri silmek Code oturumlarına dokunmaz', async () => {
    const a = await prepared();
    const s = (await env.app.inject({ method: 'POST', url: '/api/code/sessions', headers: auth(a), payload: { repo: 'octo/alpha', baseBranch: 'main' } })).json().session;
    const send = await env.app.inject({ method: 'POST', url: `/api/chats/${s.chatId}/messages`, headers: auth(a), payload: { content: 'merhaba' } });
    expect(send.statusCode).toBe(409);
    await env.app.inject({ method: 'DELETE', url: '/api/chats', headers: auth(a) });
    expect((await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}`, headers: auth(a) })).statusCode).toBe(200);
  });

  it('oturum silinince sohbet de gider; ortam silinirse oturum kalır', async () => {
    const a = await prepared();
    const envs = (await env.app.inject({ method: 'GET', url: '/api/code/environments', headers: auth(a) })).json().environments;
    const s = (await env.app.inject({ method: 'POST', url: '/api/code/sessions', headers: auth(a), payload: { repo: 'octo/alpha', baseBranch: 'main', environmentId: envs[0].id } })).json().session;
    await env.app.inject({ method: 'DELETE', url: `/api/code/environments/${envs[0].id}`, headers: auth(a) });
    const after = await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}`, headers: auth(a) });
    expect(after.json().session.environmentId).toBeNull();
    expect((await env.app.inject({ method: 'DELETE', url: `/api/code/sessions/${s.chatId}`, headers: auth(a) })).statusCode).toBe(204);
    expect((await env.app.inject({ method: 'GET', url: `/api/chats/${s.chatId}`, headers: auth(a) })).statusCode).toBe(404);
  });
});

describe('kredi', () => {
  it('harcama toplanır, limit dolunca 429', async () => {
    const a = await coder();
    const id = a.user.id;
    const c = env.ctx.code;
    expect((await c.credits(id)).used).toBe(0);
    await c.spend(id, 60);
    await c.spend(id, 41.5);
    expect((await c.credits(id)).used).toBe(101.5);
    await expect(c.spend(id, 1)).rejects.toMatchObject({ status: 429, code: 'quota_exceeded' });
    const st = await env.app.inject({ method: 'GET', url: '/api/code/status', headers: auth(a) });
    expect(st.json().credits).toMatchObject({ used: 101.5, limit: 100 });
  });

  it('disk doldukça çalışma süresi pahalanır; Claude yedeği kullanıcıya ek maliyet getirmez', () => {
    expect(diskMultiplier(0, 1000)).toBe(1);
    expect(diskMultiplier(500, 1000)).toBe(2);
    expect(diskMultiplier(5000, 1000)).toBe(3);
    const base = { sandboxSeconds: 600, diskQuotaMb: 1024 };
    expect(creditsFor({ ...base, diskUsedMb: 1024 })).toBeCloseTo(creditsFor({ ...base, diskUsedMb: 0 }) * 3, 5);
    const tokens = { tokens: 100_000, diskUsedMb: 0, diskQuotaMb: 512 };
    expect(creditsFor({ ...tokens, model: 'claude' })).toBe(creditsFor({ ...tokens, model: 'qwen' }));
    expect(creditsFor({ diskUsedMb: 1024, diskQuotaMb: 1536, rentHours: 10 })).toBeCloseTo(1, 5);
  });
});

describe('sır kutusu', () => {
  it('şifreler, çözer, kurcalanmış metni ve yanlış anahtarı reddeder', () => {
    const box = createSecretBox('a'.repeat(40));
    const sealed = box.seal('gizli');
    expect(sealed).not.toContain('gizli');
    expect(box.open(sealed)).toBe('gizli');
    expect(box.open(sealed.slice(0, -2) + 'AA')).toBeNull();
    expect(createSecretBox('b'.repeat(40)).open(sealed)).toBeNull();
  });
  it('state imzalanır, süresi dolunca ve kurcalanınca geçersiz olur', () => {
    const box = createSecretBox('a'.repeat(40));
    const t = box.signState({ u: '1' }, 60);
    expect(box.verifyState<{ u: string }>(t)?.u).toBe('1');
    expect(box.verifyState(box.signState({ u: '1' }, -1))).toBeNull();
    const [body, mac] = t.split('.');
    expect(box.verifyState(`${Buffer.from('{"u":"2","exp":9999999999}').toString('base64url')}.${mac}`)).toBeNull();
    expect(body).toBeTruthy();
  });
});

describe('karşılamalar', () => {
  it('saate ve güne göre başlık seçer; isim ekleyebilir', () => {
    const fixed = (v: number) => () => v;
    expect(pickCodeGreeting({ locale: 'en', hour: 2, day: 2, rand: fixed(0.9) })).toBe('While everyone sleeps');
    expect(pickCodeGreeting({ locale: 'tr', hour: 15, day: 5, rand: fixed(0.1) })).toContain('Cuma');
    expect(pickCodeGreeting({ locale: 'en', name: 'Enes', hour: 2, day: 2, rand: fixed(0.1) })).toContain('Enes');
    expect(pickCodeGreeting({ locale: 'en', name: 'Enes', hour: 9, day: 2, rand: fixed(0.9) })).not.toContain('Enes');
  });
});
