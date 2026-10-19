import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, member, resetDb, setup, type TestEnv } from './helpers.ts';
import { startFakeMcp, type FakeMcp } from './fake-mcp.ts';
import { createGuardedFetch } from '../src/services/mcp/guarded-fetch.ts';
import { canonicalJson, hashArgs, mcpToolName, renderResult, sanitizeSchema, wrapUntrusted } from '../src/services/mcp/tools.ts';
import { runToolCall } from '../src/services/tools/index.ts';

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
  fake.calls.length = 0;
  fake.auth.length = 0;
  fake.requireAuth = null;
  fake.legacyOnly = false;
});

const api = (a: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  env.app.inject({ method, url: `/api${url}`, headers: auth(a), payload });

async function addFake(a: Session, over: Record<string, unknown> = {}) {
  const r = await api(a, 'POST', '/mcp/servers', { label: 'Deneme Sunucu', url: fake.url, ...over });
  expect(r.statusCode).toBe(201);
  return r.json().server as { id: string; name: string; tools: Array<{ name: string; readOnly: boolean; allowed: boolean }>; [k: string]: unknown };
}

describe('MCP sunucu yönetimi', () => {
  it('ekleyince araç listesi önbelleğe alınır; salt okunur bayrağı annotations\'tan gelir', async () => {
    const a = await member(env);
    const s = await addFake(a);
    expect(s.name).toBe('deneme-sunucu');
    expect(s).toMatchObject({ authKind: 'none', connected: true, enabled: true, scopes: ['chat', 'code'], lastError: null });
    const by = Object.fromEntries(s.tools.map((t) => [t.name, t]));
    expect(Object.keys(by).sort()).toEqual(['boom', 'create_note', 'echo', 'injection']);
    expect(by.echo).toMatchObject({ readOnly: true, allowed: false });
    expect(by.create_note).toMatchObject({ readOnly: false });
    const list = (await api(a, 'GET', '/mcp/servers')).json();
    expect(list.servers).toHaveLength(1);
    expect(list.limits.servers).toBe(10);
  });

  it('anahtar/başlıklar şifreli saklanır, API yanıtlarında asla görünmez, sunucuya iletilir', async () => {
    const a = await member(env);
    fake.requireAuth = 'Bearer cok-gizli';
    const s = await addFake(a, { headers: { Authorization: 'Bearer cok-gizli' } });
    expect(s).toMatchObject({ authKind: 'headers', headerNames: ['Authorization'], lastError: null });
    expect(s.tools.length).toBe(4);
    expect(JSON.stringify(s)).not.toContain('cok-gizli');
    expect(JSON.stringify((await api(a, 'GET', '/mcp/servers')).json())).not.toContain('cok-gizli');
    const row = (await env.ctx.db.query('select auth_enc, header_names from mcp_servers')).rows[0] as { auth_enc: string; header_names: string[] };
    expect(row.auth_enc).not.toContain('cok-gizli');
    expect(row.auth_enc.startsWith('v1.')).toBe(true);
    expect(fake.auth).toContain('Bearer cok-gizli');
    // başlıkları değiştirmek yeniden bağlanır; yanlış anahtar hata olarak kaydedilir ama sunucu kalır
    const bad = await api(a, 'PATCH', `/mcp/servers/${s.id}`, { headers: { Authorization: 'Bearer yanlis' } });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().server.lastError).toBe('authorization_required');
    const cleared = await api(a, 'PATCH', `/mcp/servers/${s.id}`, { headers: {} });
    // anahtar silinince sunucu yine yetki ister: OAuth gerektiği işaretlenir
    expect(cleared.json().server).toMatchObject({ authKind: 'oauth', headerNames: [], lastError: 'authorization_required' });
  });

  it('yetki isteyen sunucu: başlıksız ekleme kaydedilir ve OAuth gerektiği işaretlenir', async () => {
    const a = await member(env);
    fake.requireAuth = 'Bearer x';
    const s = await addFake(a);
    expect(s.lastError).toBe('authorization_required');
    expect(s.authKind).toBe('oauth');
    expect(s.connected).toBe(false);
    expect(s.tools).toEqual([]);
  });

  it('eski SSE aktarımına düşer (Streamable HTTP uç noktası 404)', async () => {
    const a = await member(env);
    fake.legacyOnly = true;
    const s = await addFake(a, { url: fake.sseUrl });
    expect(s.lastError).toBeNull();
    expect(s.tools.map((t) => t.name).sort()).toEqual(['boom', 'create_note', 'echo', 'injection']);
  });

  it('erişilemeyen sunucu kaydedilir ve hata görünür; geçersiz adres/başlık reddedilir; limitler', async () => {
    const a = await member(env);
    const dead = await api(a, 'POST', '/mcp/servers', { label: 'Ölü', url: 'http://127.0.0.1:1/mcp' });
    expect(dead.statusCode).toBe(201);
    expect(dead.json().server.lastError).toBeTruthy();
    expect((await api(a, 'POST', '/mcp/servers', { label: 'X', url: 'not a url' })).statusCode).toBe(400);
    expect((await api(a, 'POST', '/mcp/servers', { label: 'X', url: fake.url, headers: { Host: 'evil' } })).statusCode).toBe(400);
    expect((await api(a, 'POST', '/mcp/servers', { label: 'X', url: fake.url, headers: { 'X-A': 'a\nb' } })).statusCode).toBe(400);
    expect((await api(a, 'POST', '/mcp/servers', { label: 'X', url: fake.url, headers: { 'X-A': 'Bearer ışık' } })).statusCode).toBe(400);
    for (let i = 0; i < 9; i++) expect((await api(a, 'POST', '/mcp/servers', { label: `S${i}`, url: fake.url })).statusCode).toBe(201);
    expect((await api(a, 'POST', '/mcp/servers', { label: 'Fazla', url: fake.url })).statusCode).toBe(400);
  });

  it('misafir kullanamaz; başka kullanıcının sunucusu 404', async () => {
    const a = await member(env);
    const b = await member(env);
    const s = await addFake(a);
    expect((await api(b, 'GET', '/mcp/servers')).json().servers).toEqual([]);
    for (const [m, u] of [['PATCH', `/mcp/servers/${s.id}`], ['DELETE', `/mcp/servers/${s.id}`], ['POST', `/mcp/servers/${s.id}/refresh`], ['POST', `/mcp/servers/${s.id}/connect`]] as const) {
      expect((await api(b, m, u, {})).statusCode, `${m} ${u}`).toBe(404);
    }
    const g = (await env.app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} })).json();
    expect((await env.app.inject({ method: 'GET', url: '/api/mcp/servers', headers: auth(g) })).statusCode).toBe(403);
    expect((await api(a, 'DELETE', `/mcp/servers/${s.id}`)).statusCode).toBe(204);
  });

  it('hazır katalog: 27 kart; yönetici istemcisi olmayan static kartlar pasif, gerçek denemede reddedenler "blocked", Microsoft 365 yakında', async () => {
    const a = await member(env);
    const r = (await api(a, 'GET', '/mcp/presets')).json();
    expect(r.presets).toHaveLength(27);
    const by = Object.fromEntries(r.presets.map((p: { id: string }) => [p.id, p]));
    expect(by.notion).toMatchObject({ auth: 'dcr', available: true, reason: null });
    expect(by.gmail).toMatchObject({ auth: 'static', available: false, reason: 'admin' });
    // HubSpot ve Box dinamik kaydı desteklemiyor (gerçek denemede doğrulandı): yönetici kaydı gerekir
    expect(by.hubspot).toMatchObject({ available: false, reason: 'admin' });
    expect(by.box).toMatchObject({ auth: 'static', available: false, reason: 'admin' });
    // Yönlendirme adresi/istemci kaydı reddedilen hizmetler kullanılamaz görünür
    for (const id of ['figma', 'asana', 'intercom', 'adobe', 'indeed', 'vercel', 'gamma', 'spotify']) expect(by[id]).toMatchObject({ available: false, reason: 'blocked' });
    expect((await api(a, 'POST', '/mcp/servers', { label: 'Figma', url: by.figma.url, preset: 'figma' })).statusCode).toBe(400);
    expect(by['microsoft-365']).toMatchObject({ available: false, reason: 'soon' });
    // pasif kart eklenemez; static olmayan OAuth kartı eklenir ve "Bağlan" bekler
    expect((await api(a, 'POST', '/mcp/servers', { label: 'Gmail', url: by.gmail.url, preset: 'gmail' })).statusCode).toBe(400);
    const n = await api(a, 'POST', '/mcp/servers', { label: 'Notion', url: by.notion.url, preset: 'notion' });
    expect(n.statusCode).toBe(201);
    expect(n.json().server).toMatchObject({ preset: 'notion', authKind: 'oauth', connected: false, tools: [] });
  });
});

describe('MCP araçları ve onay', () => {
  const run = async (a: Session, name: string, args: object, chatId = '00000000-0000-0000-0000-000000000001') => {
    const set = await env.ctx.mcp.toolsFor(a.user.id, 'chat');
    return runToolCall(set.defs, { id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }, { user: a.user as never, signal: new AbortController().signal, chatId });
  };
  async function chat(a: Session) {
    return (await api(a, 'POST', '/chats', {})).json().chat.id as string;
  }

  it('araç adları mcp__<sunucu>__<araç>; kapsam ve etkin durumu süzer; yalnız salt okunur istenebilir', async () => {
    const a = await member(env);
    const s = await addFake(a);
    const set = await env.ctx.mcp.toolsFor(a.user.id, 'chat');
    expect(set.defs.map((d) => d.name).sort()).toEqual(['mcp__deneme-sunucu__boom', 'mcp__deneme-sunucu__create_note', 'mcp__deneme-sunucu__echo', 'mcp__deneme-sunucu__injection']);
    expect(set.servers).toEqual([{ name: 'deneme-sunucu', label: 'Deneme Sunucu', tools: 4 }]);
    expect(set.defs.find((d) => d.name.endsWith('create_note'))!.description).toContain('kullanıcı onayı');
    expect((await env.ctx.mcp.toolsFor(a.user.id, 'chat', { readOnlyOnly: true })).defs.map((d) => d.name)).not.toContain('mcp__deneme-sunucu__create_note');
    await api(a, 'PATCH', `/mcp/servers/${s.id}`, { scopes: ['code'] });
    expect((await env.ctx.mcp.toolsFor(a.user.id, 'chat')).defs).toEqual([]);
    expect((await env.ctx.mcp.toolsFor(a.user.id, 'code')).defs).toHaveLength(4);
    await api(a, 'PATCH', `/mcp/servers/${s.id}`, { enabled: false });
    expect((await env.ctx.mcp.toolsFor(a.user.id, 'code')).defs).toEqual([]);
  });

  it('salt okunur araç onaysız çalışır; çıktı güvenilmez veri olarak etiketlenir', async () => {
    const a = await member(env);
    await addFake(a);
    const r = await run(a, 'mcp__deneme-sunucu__echo', { text: 'merhaba' });
    expect(r.status).toBe('done');
    expect(r.output).toContain('yankı: merhaba');
    expect(r.output).toContain('güvenilmez');
    expect(r.output).toContain('<<<');
    expect(fake.calls).toEqual([{ tool: 'echo', args: { text: 'merhaba' } }]);
    const inj = await run(a, 'mcp__deneme-sunucu__injection', {});
    expect(inj.output).toContain('dış kaynaktan gelen veri');
    expect(inj.output).toContain('[image: image/png');
    const boom = await run(a, 'mcp__deneme-sunucu__boom', {});
    expect(boom.status).toBe('error');
    expect(boom.output).toContain('patladı');
  });

  it('yazan araç ilk çağrıda ÇALIŞMAZ: onay kartı verisi ve terminal bayrağı döner', async () => {
    const a = await member(env);
    await addFake(a);
    const chatId = await chat(a);
    const r = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'Merhaba', body: 'x' }, chatId);
    expect(r.status).toBe('done');
    expect(fake.calls).toEqual([]);
    expect(r.summary).toBe('Onay bekliyor');
    expect(r.output).toContain('ONAY GEREKİYOR');
    expect(r.meta).toMatchObject({ terminal: true, approval: { server: 'Deneme Sunucu', tool: 'create_note', args: { title: 'Merhaba', body: 'x' } } });
    const id = (r.meta!.approval as { id: string }).id;
    // aynı çağrı tekrar sorulursa aynı bekleyen kayıt (çoğalmaz)
    const again = await run(a, 'mcp__deneme-sunucu__create_note', { body: 'x', title: 'Merhaba' }, chatId);
    expect((again.meta!.approval as { id: string }).id).toBe(id);
    expect((await env.ctx.db.query('select count(*)::int as n from mcp_approvals')).rows[0]).toEqual({ n: 1 });
  });

  it('"bir kez": onaydan sonra aynı çağrı çalışır ve tüketilir; farklı argüman yeniden sorar', async () => {
    const a = await member(env);
    await addFake(a);
    const chatId = await chat(a);
    const first = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'A' }, chatId);
    const id = (first.meta!.approval as { id: string }).id;
    const d = await api(a, 'POST', `/mcp/approvals/${id}`, { decision: 'once' });
    expect(d.statusCode).toBe(200);
    expect(d.json().approval.status).toBe('approved');
    // farklı argüman: onay geçmez
    expect((await run(a, 'mcp__deneme-sunucu__create_note', { title: 'B' }, chatId)).meta?.terminal).toBe(true);
    expect(fake.calls).toEqual([]);
    // başka sohbet: onay geçmez
    expect((await run(a, 'mcp__deneme-sunucu__create_note', { title: 'A' }, await chat(a))).meta?.terminal).toBe(true);
    // doğru çağrı: çalışır
    const ok = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'A' }, chatId);
    expect(ok.output).toContain('not oluşturuldu: A');
    expect(fake.calls).toEqual([{ tool: 'create_note', args: { title: 'A' } }]);
    // tüketildi: tekrar sorar
    expect((await run(a, 'mcp__deneme-sunucu__create_note', { title: 'A' }, chatId)).meta?.terminal).toBe(true);
    expect((await api(a, 'POST', `/mcp/approvals/${id}`, { decision: 'once' })).statusCode).toBe(400); // zaten yanıtlanmış
  });

  it('"hep izin ver" aracı kalıcı izinli yapar; "reddet" çalıştırmaz; süresi dolan onay geçmez', async () => {
    const a = await member(env);
    const s = await addFake(a);
    const chatId = await chat(a);
    const first = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'A' }, chatId);
    await api(a, 'POST', `/mcp/approvals/${(first.meta!.approval as { id: string }).id}`, { decision: 'always' });
    const srv = (await api(a, 'GET', '/mcp/servers')).json().servers[0];
    expect(srv.allowTools).toEqual(['create_note']);
    expect(srv.tools.find((t: { name: string }) => t.name === 'create_note').allowed).toBe(true);
    // artık hiçbir sohbette ve hiçbir argümanla sorulmaz
    const r1 = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'Z' }, await chat(a));
    expect(r1.output).toContain('not oluşturuldu: Z');

    // reddet
    await api(a, 'PATCH', `/mcp/servers/${s.id}`, { allowTools: [] });
    const p = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'R' }, chatId);
    const pid = (p.meta!.approval as { id: string }).id;
    expect((await api(a, 'POST', `/mcp/approvals/${pid}`, { decision: 'deny' })).json().approval.status).toBe('denied');
    expect((await run(a, 'mcp__deneme-sunucu__create_note', { title: 'R' }, chatId)).meta?.terminal).toBe(true);

    // süresi dolmuş onay
    const q = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'T' }, chatId);
    const qid = (q.meta!.approval as { id: string }).id;
    await env.ctx.db.query("update mcp_approvals set created_at = now() - interval '2 hours' where id = $1", [qid]);
    expect((await api(a, 'POST', `/mcp/approvals/${qid}`, { decision: 'once' })).statusCode).toBe(400);
  });

  it('sunucu geneli "otomatik onay": yazan araç da sormadan çalışır; başka kullanıcı onayını göremez', async () => {
    const a = await member(env);
    const b = await member(env);
    const s = await addFake(a);
    const chatId = await chat(a);
    const pend = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'Gizli' }, chatId);
    const id = (pend.meta!.approval as { id: string }).id;
    expect((await api(b, 'GET', `/mcp/approvals/${id}`)).statusCode).toBe(404);
    expect((await api(b, 'POST', `/mcp/approvals/${id}`, { decision: 'once' })).statusCode).toBe(404);
    await api(a, 'PATCH', `/mcp/servers/${s.id}`, { autoApprove: true });
    const ok = await run(a, 'mcp__deneme-sunucu__create_note', { title: 'Oto' }, chatId);
    expect(ok.output).toContain('not oluşturuldu: Oto');
  });

  it('sohbet olmadan (chatId yok) yazan araç çalışmaz', async () => {
    const a = await member(env);
    await addFake(a);
    const set = await env.ctx.mcp.toolsFor(a.user.id, 'code');
    const r = await runToolCall(set.defs, { id: 'c1', type: 'function', function: { name: 'mcp__deneme-sunucu__create_note', arguments: '{"title":"x"}' } }, { user: a.user as never, signal: new AbortController().signal });
    expect(r.status).toBe('error');
    expect(fake.calls).toEqual([]);
  });

  it('oturum bağlantısı kopan sunucuda araç hata verir, çökmez', async () => {
    const a = await member(env);
    await addFake(a);
    await fake.close();
    const r = await run(a, 'mcp__deneme-sunucu__echo', { text: 'x' });
    expect(r.status).toBe('error');
    fake = await startFakeMcp();
  });
});

describe('MCP yardımcıları', () => {
  it('araç adı: ≤64 karakter, geçersiz karakterler temizlenir, çakışmada sayaç', () => {
    const used = new Set<string>();
    expect(mcpToolName('gh', 'search.issues', used)).toBe('mcp__gh__search_issues');
    expect(mcpToolName('gh', 'search_issues', used)).toBe('mcp__gh__search_issues_2');
    const long = mcpToolName('uzun-sunucu-adi', 'x'.repeat(100), used);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.startsWith('mcp__uzun-sunucu-adi__x')).toBe(true);
    expect(mcpToolName('uzun-sunucu-adi', 'y'.repeat(100), used)).not.toBe(long);
  });

  it('şema temizliği: kök object, $schema atılır, bozuk/aşırı büyük şema gevşek şemaya düşer', () => {
    expect(sanitizeSchema({ $schema: 'x', $id: 'y', type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })).toEqual({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
    expect(sanitizeSchema(null)).toMatchObject({ type: 'object', additionalProperties: true });
    expect(sanitizeSchema({ type: 'string' })).toMatchObject({ type: 'object' });
    expect(sanitizeSchema({ type: 'object' })).toEqual({ type: 'object', properties: {} });
    expect(sanitizeSchema({ type: 'object', properties: { x: { description: 'a'.repeat(9000) } } })).toMatchObject({ additionalProperties: true });
  });

  it('argüman özeti anahtar sırasından bağımsızdır', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
    expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }));
  });

  it('sonuç dönüşümü ve etiket', () => {
    expect(renderResult({ content: [{ type: 'text', text: 'a' }, { type: 'resource_link', name: 'N', uri: 'https://x/y' }, { type: 'resource', resource: { uri: 'u', text: 'gövde' } }], isError: false })).toBe('a\n[bağlantı] N https://x/y\ngövde');
    expect(renderResult({ content: [], structured: { k: 1 }, isError: false })).toContain('"k": 1');
    expect(renderResult({ content: [], isError: false })).toBe('(boş sonuç)');
    expect(wrapUntrusted('L', 't', 'gövde')).toContain('<<<\ngövde\n>>>');
  });
});

describe('guarded-fetch (SSRF)', () => {
  const g = createGuardedFetch();
  it('http, localhost, özel/yerel adresler, kimlik bilgili adresler ve yasak portlar reddedilir', async () => {
    for (const u of ['http://example.com/mcp', 'https://localhost/mcp', 'https://127.0.0.1/mcp', 'https://10.0.0.5/mcp', 'https://192.168.1.1/mcp', 'https://169.254.169.254/latest', 'https://[::1]/mcp', 'https://user:pw@example.com/mcp', 'https://example.com:22/mcp', 'https://intranet/mcp', 'https://x.internal/mcp']) {
      await expect(g(u), u).rejects.toThrow();
    }
  });
});
