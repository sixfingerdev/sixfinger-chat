import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEgressProxy, hostAllowed, isPublicIp, matchesDomain, type EgressProxy } from '../src/egress.ts';

describe('alan adı eşleştirme', () => {
  it('joker yalnızca alt alan adlarını kapsar', () => {
    expect(matchesDomain('a.example.com', '*.example.com')).toBe(true);
    expect(matchesDomain('x.y.example.com', '*.example.com')).toBe(true);
    expect(matchesDomain('example.com', '*.example.com')).toBe(false);
    expect(matchesDomain('evilexample.com', '*.example.com')).toBe(false);
    expect(matchesDomain('example.com.evil.io', '*.example.com')).toBe(false);
    expect(matchesDomain('EXAMPLE.com.', 'example.com')).toBe(true);
  });
  it('modlara göre izin verir', () => {
    expect(hostAllowed('registry.npmjs.org', { mode: 'trusted', domains: [] })).toBe(true);
    expect(hostAllowed('raw.githubusercontent.com', { mode: 'trusted', domains: [] })).toBe(true);
    expect(hostAllowed('evil.com', { mode: 'trusted', domains: [] })).toBe(false);
    expect(hostAllowed('github.com.evil.com', { mode: 'trusted', domains: [] })).toBe(false);
    expect(hostAllowed('anything.com', { mode: 'full', domains: [] })).toBe(true);
    expect(hostAllowed('anything.com', { mode: 'none', domains: ['anything.com'] })).toBe(false);
    expect(hostAllowed('api.mine.io', { mode: 'custom', domains: ['*.mine.io'] })).toBe(true);
    expect(hostAllowed('registry.npmjs.org', { mode: 'custom', domains: ['*.mine.io'] })).toBe(false);
    // IP literal yalnızca full modunda
    expect(hostAllowed('93.184.216.34', { mode: 'trusted', domains: [] })).toBe(false);
    expect(hostAllowed('93.184.216.34', { mode: 'full', domains: [] })).toBe(true);
  });
});

describe('genel IP denetimi', () => {
  it.each([
    ['10.0.0.1', false], ['127.0.0.1', false], ['192.168.1.5', false], ['172.16.0.1', false], ['172.31.255.255', false],
    ['169.254.169.254', false], ['100.64.0.1', false], ['0.0.0.0', false], ['224.0.0.1', false], ['198.18.0.1', false],
    ['172.15.0.1', true], ['172.32.0.1', true], ['8.8.8.8', true], ['93.184.216.34', true], ['140.82.112.3', true],
    ['::1', false], ['::', false], ['fe80::1', false], ['fd00::1', false], ['fc00::1', false], ['ff02::1', false],
    ['::ffff:10.0.0.1', false], ['::ffff:8.8.8.8', true], ['2606:4700:4700::1111', true], ['not-an-ip', false],
  ])('%s → %s', (ip, expected) => expect(isPublicIp(ip)).toBe(expected));
});

describe('proxy', () => {
  let proxy: EgressProxy;
  let proxyPort: number;
  let origin: http.Server;
  let originPort: number;
  let echo: net.Server;
  let echoPort: number;
  const resolved = new Map<string, string[]>();

  beforeAll(async () => {
    origin = http.createServer((req, res) => res.end(`origin:${req.headers.host}${req.url}`));
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r));
    originPort = (origin.address() as net.AddressInfo).port;
    echo = net.createServer((s) => s.on('data', (d) => s.write(`echo:${d}`)));
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
    echoPort = (echo.address() as net.AddressInfo).port;
    // Testte "genel" sayılacak adresler yerel olsun; gerçek denetimi ayrı testte yapıyoruz.
    proxy = createEgressProxy({
      ports: [80, 443, echoPort, originPort],
      resolve: async (h) => resolved.get(h) ?? ['127.0.0.1'],
      ipOk: (ip) => ip === '127.0.0.1' || isPublicIp(ip) ,
      idleMs: 2_000,
      maxPerSession: 3,
    });
    proxyPort = await proxy.listen(0, '127.0.0.1');
    proxy.register('trusted1', 'pw', { mode: 'trusted', domains: [] });
    proxy.register('custom1', 'pw', { mode: 'custom', domains: ['*.mine.io', 'registry.npmjs.org'] });
    proxy.register('full1', 'pw', { mode: 'full', domains: [] });
    proxy.register('none1', 'pw', { mode: 'none', domains: [] });
  });
  afterAll(async () => {
    await proxy.close();
    origin.close();
    echo.close();
  });

  const auth = (id: string, pw = 'pw') => `Basic ${Buffer.from(`${id}:${pw}`).toString('base64')}`;

  /** CONNECT isteği gönderir; ilk yanıt satırını ve (tünel açılırsa) bir veri turunu döndürür. */
  function connect(target: string, id: string | null, pw?: string, payload = 'merhaba'): Promise<{ status: number; body: string; echoed: string }> {
    return new Promise((resolve) => {
      const s = net.connect(proxyPort, '127.0.0.1');
      let buf = '';
      let status = 0;
      let opened = false;
      s.on('connect', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${id ? `Proxy-Authorization: ${auth(id, pw)}\r\n` : ''}\r\n`));
      s.on('data', (d) => {
        buf += d.toString();
        if (!status) {
          const head = /^HTTP\/1\.1 (\d+)/.exec(buf);
          if (!head) return;
          status = Number(head[1]);
        }
        if (status === 200 && !opened && buf.includes('\r\n\r\n')) {
          opened = true;
          buf = buf.slice(buf.indexOf('\r\n\r\n') + 4);
          s.write(payload);
          return;
        }
        if (opened && buf.includes('echo:')) {
          s.destroy();
          resolve({ status, body: '', echoed: buf });
        }
      });
      s.on('close', () => resolve({ status, body: buf.split('\r\n\r\n')[1] ?? '', echoed: '' }));
      setTimeout(() => s.destroy(), 3_000);
    });
  }

  it('kimlik doğrulaması olmadan ya da yanlış parolayla 407', async () => {
    expect((await connect('registry.npmjs.org:443', null)).status).toBe(407);
    expect((await connect('registry.npmjs.org:443', 'trusted1', 'yanlis')).status).toBe(407);
    expect((await connect('registry.npmjs.org:443', 'yok')).status).toBe(407);
  });

  it('izinli alan adına tünel açar ve veriyi iletir', async () => {
    const r = await connect(`registry.npmjs.org:${echoPort}`, 'trusted1', 'pw', 'merhaba');
    expect(r.status).toBe(200);
    expect(r.echoed).toContain('echo:merhaba');
    expect((await connect(`registry.npmjs.org:${echoPort}`, 'custom1')).echoed).toContain('echo:'); // custom listede var
    expect((await connect(`anything.example:${echoPort}`, 'full1')).echoed).toContain('echo:');
  });

  it('80/443 dışındaki portlar reddedilir', async () => {
    const r = await connect('registry.npmjs.org:25', 'trusted1');
    expect(r.status).toBe(403);
    expect(r.body).toContain('80 ve 443');
  });

  it('izin listesinde olmayan alan adı 403 ve açıklayıcı mesaj döner', async () => {
    const r = await connect('evil.com:443', 'trusted1');
    expect(r.status).toBe(403);
    expect(r.body).toContain('izin listesinde değil');
    const n = await connect('registry.npmjs.org:443', 'none1');
    expect(n.status).toBe(403);
    expect(n.body).toContain('kapalı');
  });

  it('custom modunda yalnızca kendi listesi', async () => {
    expect((await connect('evil.com:443', 'custom1')).status).toBe(403);
    expect((await connect('mine.io:443', 'custom1')).status).toBe(403); // joker apex'i kapsamaz
  });

  it('genel olmayan adrese çözülen alan adı reddedilir (DNS rebinding / karışık yanıt)', async () => {
    const strict = createEgressProxy({ resolve: async (h) => (h === 'rebind.example.com' ? ['8.8.8.8', '10.0.0.5'] : h === 'internal.example.com' ? ['192.168.1.10'] : ['8.8.8.8']) });
    const port = await strict.listen(0, '127.0.0.1');
    strict.register('s', 'pw', { mode: 'full', domains: [] });
    const attempt = (host: string) =>
      new Promise<string>((resolve) => {
        const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${auth('s')}\r\n\r\n`));
        let buf = '';
        s.on('data', (d) => (buf += d));
        s.on('close', () => resolve(buf));
        setTimeout(() => s.destroy(), 2_000);
      });
    expect(await attempt('rebind.example.com')).toContain('403');
    expect(await attempt('internal.example.com')).toContain('genel olmayan');
    expect(await attempt('10.0.0.1')).toContain('403'); // IP literal
    expect(await attempt('169.254.169.254')).toContain('genel olmayan');
    await strict.close();
  });

  it('düz HTTP yönlendirmesi (mutlak URI) çalışır', async () => {
    const get = (url: string, id: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { host: new URL(url).host, 'proxy-authorization': auth(id) } }, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve({ status: res.statusCode!, body: b }));
        });
        req.on('error', reject);
        req.end();
      });
    const ok = await get(`http://files.mine.io:${originPort}/dosya?x=1`, 'custom1');
    expect(ok).toEqual({ status: 200, body: `origin:files.mine.io:${originPort}/dosya?x=1` });
    expect((await get('http://evil.com/x', 'trusted1')).status).toBe(403);
    expect((await get('http://registry.npmjs.org/x', 'none1')).status).toBe(403);
    const noAuth = await new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port: proxyPort, path: 'http://a.mine.io/', headers: { host: 'a.mine.io' } }, (res) => resolve(res.statusCode!));
    });
    expect(noAuth).toBe(407);
  });

  it('kimlik başına eşzamanlı bağlantı sınırı', async () => {
    proxy.register('limited', 'pw', { mode: 'full', domains: [] });
    const open = () =>
      new Promise<net.Socket>((resolve) => {
        const s = net.connect(proxyPort, '127.0.0.1', () => s.write(`CONNECT a.example:${echoPort} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${auth('limited')}\r\n\r\n`));
        s.once('data', () => resolve(s));
      });
    const held = await Promise.all([open(), open(), open()]); // sınır 3
    const fourth = await connect(`a.example:${echoPort}`, 'limited');
    expect(fourth.status).toBe(403);
    expect(fourth.body).toContain('eşzamanlı');
    held.forEach((s) => s.destroy());
  });

  it('kayıt silinince erişim kesilir; sayaçlar tutulur', async () => {
    proxy.register('temp', 'pw', { mode: 'full', domains: [] });
    expect((await connect('evil.com:25', 'temp')).status).toBe(403);
    expect(proxy.stats('temp')?.denied).toBeGreaterThanOrEqual(1);
    proxy.unregister('temp');
    expect((await connect('evil.com:443', 'temp')).status).toBe(407);
  });
});
