import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, member, resetDb, setup, type TestEnv } from './helpers.ts';
import { MCP_LOOPBACK_REDIRECT, parseOAuthCallback } from '@sixfinger/shared';
import { startFakeMcp, type FakeMcp } from './fake-mcp.ts';

let env: TestEnv;
let fake: FakeMcp;
type Session = Awaited<ReturnType<typeof member>>;

beforeAll(async () => {
  fake = await startFakeMcp();
  env = await setup([], {}, { mcpFetch: fetch as never });
});
afterAll(async () => {
  await env.app.close();
  await fake.close();
});
beforeEach(async () => {
  await resetDb(env.ctx);
  fake.oauth = true;
  fake.validTokens = new Set();
  fake.registrations.length = 0;
  fake.tokenRequests.length = 0;
  fake.calls.length = 0;
  Object.assign(env.ctx.config, { MCP_GOOGLE_CLIENT_ID: '', MCP_GOOGLE_CLIENT_SECRET: '' });
});

const api = (a: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => env.app.inject({ method, url: `/api${url}`, headers: auth(a), payload });
const addOauth = async (a: Session, preset = 'notion') => {
  const r = await api(a, 'POST', '/mcp/servers', { label: 'Notion', url: fake.url, preset });
  expect(r.statusCode).toBe(201);
  return r.json().server as { id: string; connected: boolean; tools: unknown[]; authKind: string; lastError: string | null };
};

describe('MCP OAuth (dinamik istemci kaydı)', () => {
  it('bağlan → yetkilendirme adresi (PKCE, state, yönlendirme) → complete → araçlar listelenir; jetonlar şifreli saklanır', async () => {
    const a = await member(env);
    const s = await addOauth(a);
    expect(s).toMatchObject({ authKind: 'oauth', connected: false, tools: [] });

    const c = await api(a, 'POST', `/mcp/servers/${s.id}/connect`, { target: 'web' });
    expect(c.statusCode).toBe(200);
    const url = new URL(c.json().authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${fake.base}/authorize`);
    expect(url.searchParams.get('client_id')).toBe('dyn-client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe(`${env.ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/mcp/oauth/callback`);
    expect(fake.registrations).toHaveLength(1);
    expect(fake.registrations[0]).toMatchObject({ client_name: 'SixFinger', token_endpoint_auth_method: 'none' });
    const state = url.searchParams.get('state')!;
    expect(state).toBeTruthy();

    // tarayıcı geri dönüşü (herkese açık): web hedefi → /connectors'a code + state ile yönlendirir
    const cb = await env.app.inject({ method: 'GET', url: `/api/mcp/oauth/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(cb.statusCode).toBe(302);
    const loc = new URL(cb.headers.location as string);
    expect(loc.pathname).toBe('/connectors');
    expect(loc.searchParams.get('mcp_code')).toBe('abc');
    expect(loc.searchParams.get('mcp_state')).toBe(state);

    // oturumlu istemci tamamlar
    const done = await api(a, 'POST', '/mcp/oauth/complete', { code: 'abc', state });
    expect(done.statusCode).toBe(200);
    const srv = done.json().server;
    expect(srv).toMatchObject({ connected: true, lastError: null });
    expect(srv.tools.map((t: { name: string }) => t.name).sort()).toEqual(['boom', 'create_note', 'echo', 'injection']);
    expect(fake.tokenRequests[0]).toMatchObject({ grant_type: 'authorization_code', code: 'abc', client_id: 'dyn-client' });
    expect(fake.tokenRequests[0]!.code_verifier).toBeTruthy();

    const row = (await env.ctx.db.query('select auth_enc from mcp_servers')).rows[0] as { auth_enc: string };
    expect(row.auth_enc).not.toContain('tok-1');
    expect(row.auth_enc).not.toContain('ref-1');
    expect(JSON.stringify((await api(a, 'GET', '/mcp/servers')).json())).not.toMatch(/tok-1|ref-1|dyn-client/);
    // araç çalışır (OAuth jetonuyla)
    const set = await env.ctx.mcp.toolsFor(a.user.id, 'chat');
    expect(set.defs.length).toBe(4);
  });

  it('masaüstü (loopback) akışı: kopyala-yapıştır adresiyle bağlanan kartlar 127.0.0.1 adresiyle kaydolur, manual=true döner; kod değişimi aynı adresle yapılır', async () => {
    const a = await member(env);
    const s = await addOauth(a, 'canva');
    const c = await api(a, 'POST', `/mcp/servers/${s.id}/connect`, { target: 'web' });
    expect(c.statusCode).toBe(200);
    expect(c.json().manual).toBe(true);
    const url = new URL(c.json().authorizeUrl);
    expect(url.searchParams.get('redirect_uri')).toBe(MCP_LOOPBACK_REDIRECT);
    expect(fake.registrations[0]).toMatchObject({ redirect_uris: [MCP_LOOPBACK_REDIRECT] });
    // kullanıcı tarayıcının hata sayfasındaki adresi yapıştırır; istemci code + state'i çıkarıp complete'e gönderir
    const pasted = `${MCP_LOOPBACK_REDIRECT}?code=abc&state=${encodeURIComponent(url.searchParams.get('state')!)}`;
    const parsed = parseOAuthCallback(pasted);
    expect(parsed).toEqual({ code: 'abc', state: url.searchParams.get('state') });
    const done = await api(a, 'POST', '/mcp/oauth/complete', parsed as object);
    expect(done.json().server).toMatchObject({ connected: true, lastError: null });
    expect(fake.tokenRequests[0]).toMatchObject({ redirect_uri: MCP_LOOPBACK_REDIRECT });
    // normal kart https geri dönüş adresini kullanmaya devam eder ve manual=false döner
    const n = await addOauth(a, 'notion');
    const c2 = await api(a, 'POST', `/mcp/servers/${n.id}/connect`, { target: 'web' });
    expect(c2.json().manual).toBe(false);
  });

  it('parseOAuthCallback: tam adres, yalnızca sorgu dizesi, hata ve eksik durumlar', () => {
    expect(parseOAuthCallback('http://127.0.0.1:8976/callback?code=a%20b&state=xyz')).toEqual({ code: 'a b', state: 'xyz' });
    expect(parseOAuthCallback('  ?code=1&state=2 ')).toEqual({ code: '1', state: '2' });
    expect(parseOAuthCallback('code=1&state=2')).toEqual({ code: '1', state: '2' });
    expect(parseOAuthCallback('http://127.0.0.1:8976/callback?error=access_denied&error_description=Reddedildi')).toEqual({ error: 'Reddedildi' });
    expect(parseOAuthCallback('http://127.0.0.1:8976/callback?code=1')).toBeNull();
    expect(parseOAuthCallback('   ')).toBeNull();
  });

  it('süresi dolan/geçersiz erişim jetonu yenileme jetonuyla otomatik yenilenir', async () => {
    const a = await member(env);
    const s = await addOauth(a);
    const state = new URL((await api(a, 'POST', `/mcp/servers/${s.id}/connect`, {})).json().authorizeUrl).searchParams.get('state')!;
    await api(a, 'POST', '/mcp/oauth/complete', { code: 'abc', state });
    // sunucu eski jetonu artık geçersiz sayar
    fake.validTokens.clear();
    const r = await api(a, 'POST', `/mcp/servers/${s.id}/refresh`);
    expect(r.json().server).toMatchObject({ connected: true, lastError: null });
    expect(r.json().server.tools).toHaveLength(4);
    expect(fake.tokenRequests.some((t) => t.grant_type === 'refresh_token' && t.refresh_token === 'ref-1')).toBe(true);
  });

  it('geri dönüş ucu: uygulama hedefi derin bağlantı sayfası; bozuk state 400; hata parametresi mcp=error', async () => {
    const a = await member(env);
    const s = await addOauth(a);
    const state = new URL((await api(a, 'POST', `/mcp/servers/${s.id}/connect`, { target: 'app' })).json().authorizeUrl).searchParams.get('state')!;
    const app = await env.app.inject({ method: 'GET', url: `/api/mcp/oauth/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(app.statusCode).toBe(200);
    expect(app.body).toContain('sixfinger://connectors?mcp_code=abc');
    const err = await env.app.inject({ method: 'GET', url: `/api/mcp/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}` });
    expect(err.body).toContain('sixfinger://connectors?mcp=error');
    expect((await env.app.inject({ method: 'GET', url: '/api/mcp/oauth/callback?code=abc&state=sahte' })).statusCode).toBe(400);
    expect((await env.app.inject({ method: 'GET', url: '/api/mcp/oauth/callback?code=abc' })).statusCode).toBe(400);
  });

  it('complete: başka kullanıcının state\'i, bozuk state ve yanlış kod reddedilir', async () => {
    const a = await member(env);
    const b = await member(env);
    const s = await addOauth(a);
    const state = new URL((await api(a, 'POST', `/mcp/servers/${s.id}/connect`, {})).json().authorizeUrl).searchParams.get('state')!;
    expect((await api(b, 'POST', '/mcp/oauth/complete', { code: 'abc', state })).statusCode).toBe(400);
    expect((await api(a, 'POST', '/mcp/oauth/complete', { code: 'abc', state: 'sahte.state' })).statusCode).toBe(400);
    const bad = await api(a, 'POST', '/mcp/oauth/complete', { code: 'yanlis', state });
    expect(bad.statusCode).toBe(400);
    expect((await api(a, 'GET', '/mcp/servers')).json().servers[0]).toMatchObject({ connected: false });
  });

  it('bağlantıyı kes: jetonlar silinir, araçlar temizlenir; yeniden bağlanabilir; adres değişince eski jeton geçersiz', async () => {
    const a = await member(env);
    const s = await addOauth(a);
    const connect = async () => {
      const st = new URL((await api(a, 'POST', `/mcp/servers/${s.id}/connect`, {})).json().authorizeUrl).searchParams.get('state')!;
      return (await api(a, 'POST', '/mcp/oauth/complete', { code: 'abc', state: st })).json().server;
    };
    expect((await connect()).connected).toBe(true);
    const off = (await api(a, 'POST', `/mcp/servers/${s.id}/disconnect`)).json().server;
    expect(off).toMatchObject({ connected: false, tools: [], lastError: 'authorization_required' });
    expect((await connect()).connected).toBe(true);
    const moved = (await api(a, 'PATCH', `/mcp/servers/${s.id}`, { url: `${fake.base}/mcp?x=1` })).json().server;
    expect(moved.connected).toBe(false);
  });

  it('anahtarlı (başlıklı) bağlayıcı OAuth başlatamaz', async () => {
    const a = await member(env);
    const r = await api(a, 'POST', '/mcp/servers', { label: 'Anahtarlı', url: fake.url, headers: { Authorization: 'Bearer x' } });
    expect((await api(a, 'POST', `/mcp/servers/${r.json().server.id}/connect`, {})).statusCode).toBe(400);
  });
});

describe('MCP OAuth (yönetici istemcisi: Google/Slack)', () => {
  it('yapılandırılmamış static kart reddedilir; yapılandırılınca dinamik kayıt atlanır, kapsamlar ve offline erişim eklenir, secret jetona iletilir', async () => {
    const a = await member(env);
    expect((await api(a, 'POST', '/mcp/servers', { label: 'Drive', url: fake.url, preset: 'google-drive' })).statusCode).toBe(400);
    Object.assign(env.ctx.config, { MCP_GOOGLE_CLIENT_ID: 'g-id', MCP_GOOGLE_CLIENT_SECRET: 'g-secret' });
    const s = await addOauth(a, 'google-drive');
    const c = await api(a, 'POST', `/mcp/servers/${s.id}/connect`, { target: 'web' });
    const url = new URL(c.json().authorizeUrl);
    expect(url.searchParams.get('client_id')).toBe('g-id');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file');
    expect(fake.registrations).toHaveLength(0);
    const done = await api(a, 'POST', '/mcp/oauth/complete', { code: 'abc', state: url.searchParams.get('state')! });
    expect(done.statusCode).toBe(200);
    expect(fake.tokenRequests[0]).toMatchObject({ client_id: 'g-id', client_secret: 'g-secret' });
    expect(done.json().server.connected).toBe(true);
    expect(JSON.stringify(done.json())).not.toContain('g-secret');
    // presets: artık kullanılabilir
    const p = (await api(a, 'GET', '/mcp/presets')).json().presets.find((x: { id: string }) => x.id === 'google-drive');
    expect(p).toMatchObject({ available: true, reason: null });
  });
});
