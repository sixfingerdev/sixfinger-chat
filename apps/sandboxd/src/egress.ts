import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';

/**
 * Code sandbox'larının tek internet çıkışı: kimlik doğrulamalı, alan adı izin listeli bir HTTP/CONNECT proxy'si.
 * Sandbox konteynerleri Docker'ın `--internal` ağındadır (doğrudan dış erişimleri YOKTUR); yalnızca bu proxy'ye ulaşabilirler.
 * Proxy her bağlantıda alan adını kendisi çözer, yalnızca GENEL IP'lere bağlanır (özel/yerel/bağlantı-yerel adresler, DNS rebinding
 * dahil, reddedilir) ve yalnızca 80/443 portlarına izin verir.
 */

export type NetworkMode = 'none' | 'trusted' | 'full' | 'custom';

export interface EgressPolicy {
  mode: NetworkMode;
  /** `custom` modunda izinli alan adları (`*.example.com` alt alan adlarını kapsar). */
  domains: string[];
}

/** "Trusted": bilinen paket kaynakları ve GitHub. */
export const TRUSTED_DOMAINS = [
  'registry.npmjs.org', '*.npmjs.org', 'registry.yarnpkg.com', 'nodejs.org', '*.nodejs.org',
  'pypi.org', 'files.pythonhosted.org',
  'github.com', 'api.github.com', 'codeload.github.com', '*.githubusercontent.com',
  'crates.io', 'static.crates.io', 'index.crates.io',
  'proxy.golang.org', 'sum.golang.org', 'go.dev',
  'repo.maven.apache.org', 'repo1.maven.org', 'rubygems.org', 'index.rubygems.org',
  'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'cdn.playwright.dev', 'playwright.download.prss.microsoft.com',
] as const;

const DEFAULT_PORTS = [80, 443];

/** `host` bir alan adı kalıbıyla eşleşir mi? `*.x.com` yalnızca alt alan adlarını, `x.com` yalnızca kendisini kapsar. */
export function matchesDomain(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

export function hostAllowed(host: string, policy: EgressPolicy): boolean {
  if (policy.mode === 'none') return false;
  if (net.isIP(host)) return policy.mode === 'full';
  if (policy.mode === 'full') return true;
  const list = policy.mode === 'trusted' ? TRUSTED_DOMAINS : policy.domains;
  return list.some((p) => matchesDomain(host, p));
}

/** IPv4/IPv6 adresi genel internette mi? (özel, yerel, bağlantı-yerel, CGNAT, çoklu yayın, ayrılmış aralıklar değil) */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // bağlantı-yerel + bulut meta veri
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && ip.startsWith('192.0.0.')))) return false;
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmark
    return true;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPublicIp(mapped[1]!);
    if (/^f[cd]/.test(x)) return false; // ULA fc00::/7
    if (/^fe[89ab]/.test(x)) return false; // bağlantı-yerel fe80::/10
    if (x.startsWith('ff')) return false; // çoklu yayın
    if (x.startsWith('64:ff9b') || x.startsWith('2001:db8') || x.startsWith('100:')) return false;
    return true;
  }
  return false;
}

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

export interface EgressOptions {
  log?: Log;
  /** Alan adı çözümü (testlerde sahtesi verilir). */
  resolve?: (host: string) => Promise<string[]>;
  /** Hedef IP kabul testi (testlerde yerel adreslere izin vermek için). */
  ipOk?: (ip: string) => boolean;
  idleMs?: number;
  /** İzinli hedef portlar (varsayılan 80 ve 443; testlerde yerel sunucu portu eklenir). */
  ports?: number[];
  /** Kimlik başına eşzamanlı bağlantı sınırı. */
  maxPerSession?: number;
}

interface Entry {
  secret: string;
  policy: EgressPolicy;
  active: number;
  denied: number;
}

const defaultResolve = async (host: string): Promise<string[]> => (await dnsLookup(host, { all: true })).map((r) => r.address);

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createEgressProxy(opts: EgressOptions = {}) {
  const resolve = opts.resolve ?? defaultResolve;
  const ipOk = opts.ipOk ?? isPublicIp;
  const idleMs = opts.idleMs ?? 120_000;
  const ALLOWED_PORTS = new Set(opts.ports ?? DEFAULT_PORTS);
  const maxPerSession = opts.maxPerSession ?? 64;
  const entries = new Map<string, Entry>();

  const server = http.createServer();
  server.keepAliveTimeout = 5_000;

  /** Proxy-Authorization: Basic kullanıcı:parola → kayıtlı kimlik. */
  function authenticate(header: string | undefined): { id: string; entry: Entry } | null {
    if (!header?.startsWith('Basic ')) return null;
    const raw = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i < 1) return null;
    const id = raw.slice(0, i);
    const entry = entries.get(id);
    if (!entry || !safeEqual(raw.slice(i + 1), entry.secret)) return null;
    return { id, entry };
  }

  /** Alan adını çözer; HERHANGİ bir adres genel değilse reddeder (DNS rebinding / karışık yanıt). */
  async function target(host: string, entry: Entry): Promise<{ ip: string } | { error: string }> {
    if (!hostAllowed(host, entry.policy)) {
      entry.denied++;
      const why =
        entry.policy.mode === 'none'
          ? 'bu ortamın ağ erişimi kapalı (None)'
          : entry.policy.mode === 'full'
            ? 'adres izinli değil'
            : `${host} bu ortamın izin listesinde değil (${entry.policy.mode})`;
      return { error: `SixFinger ağ politikası: ${why}.` };
    }
    let addrs: string[];
    try {
      addrs = net.isIP(host) ? [host] : await resolve(host);
    } catch {
      return { error: `Alan adı çözülemedi: ${host}` };
    }
    if (!addrs.length || !addrs.every(ipOk)) return { error: `SixFinger ağ politikası: ${host} genel olmayan bir adrese çözülüyor, engellendi.` };
    return { ip: addrs[0]! };
  }

  const deny = (socket: net.Socket, status: number, message: string, extra = '') => {
    socket.end(`HTTP/1.1 ${status} ${status === 407 ? 'Proxy Authentication Required' : 'Forbidden'}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  };

  server.on('connect', (req, clientSocket: net.Socket, head) => {
    clientSocket.on('error', () => {});
    const who = authenticate(req.headers['proxy-authorization']);
    if (!who) return deny(clientSocket, 407, 'Proxy kimlik doğrulaması gerekli.', 'Proxy-Authenticate: Basic realm="sixfinger"\r\n');
    const { entry } = who;
    const m = /^(.+):(\d+)$/.exec(req.url ?? '');
    if (!m) return deny(clientSocket, 400, 'Geçersiz hedef.');
    const host = m[1]!.replace(/^\[|\]$/g, '');
    const port = Number(m[2]);
    if (!ALLOWED_PORTS.has(port)) {
      entry.denied++;
      return deny(clientSocket, 403, `SixFinger ağ politikası: yalnızca 80 ve 443 portlarına izin verilir (istenen ${port}).`);
    }
    if (entry.active >= maxPerSession) return deny(clientSocket, 403, 'Çok fazla eşzamanlı bağlantı.');
    entry.active++;
    let released = false;
    const done = () => {
      if (!released) {
        released = true;
        entry.active--;
      }
    };
    clientSocket.on('close', done);
    void (async () => {
      const t = await target(host, entry);
      if ('error' in t) {
        opts.log?.info({ host, mode: entry.policy.mode }, 'proxy: engellendi');
        done();
        return deny(clientSocket, 403, t.error);
      }
      const upstream = net.connect({ host: t.ip, port });
      upstream.setTimeout(idleMs, () => upstream.destroy());
      clientSocket.setTimeout(idleMs, () => clientSocket.destroy());
      upstream.on('error', () => {
        done();
        if (!clientSocket.writableEnded) deny(clientSocket, 403, `Bağlanılamadı: ${host}`);
      });
      upstream.on('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      clientSocket.on('close', () => upstream.destroy());
      upstream.on('close', () => clientSocket.destroy());
    })();
  });

  // Düz HTTP (mutlak URI): `GET http://host/yol`
  server.on('request', (req, res) => {
    const who = authenticate(req.headers['proxy-authorization'] as string | undefined);
    const fail = (status: number, message: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close', ...headers });
      res.end(message);
    };
    if (!who) return fail(407, 'Proxy kimlik doğrulaması gerekli.', { 'proxy-authenticate': 'Basic realm="sixfinger"' });
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      return fail(400, 'Proxy yalnızca mutlak adreslerle (http://…) çalışır.');
    }
    if (url.protocol !== 'http:') return fail(400, 'Yalnızca http:// desteklenir (https için CONNECT).');
    const port = Number(url.port || 80);
    if (!ALLOWED_PORTS.has(port)) return fail(403, `SixFinger ağ politikası: yalnızca 80 ve 443 portlarına izin verilir (istenen ${port}).`);
    const { entry } = who;
    if (entry.active >= maxPerSession) return fail(403, 'Çok fazla eşzamanlı bağlantı.');
    entry.active++;
    let released = false;
    const done = () => {
      if (!released) {
        released = true;
        entry.active--;
      }
    };
    res.on('close', done);
    void (async () => {
      const t = await target(url.hostname.replace(/^\[|\]$/g, ''), entry);
      if ('error' in t) {
        done();
        return fail(403, t.error);
      }
      const headers = { ...req.headers };
      for (const h of ['proxy-authorization', 'proxy-connection', 'connection']) delete headers[h];
      const up = http.request({ host: t.ip, port, method: req.method, path: url.pathname + url.search, headers: { ...headers, host: url.host } }, (ur) => {
        const h = { ...ur.headers };
        res.writeHead(ur.statusCode ?? 502, h);
        ur.pipe(res);
      });
      up.setTimeout(idleMs, () => up.destroy());
      up.on('error', () => {
        done();
        if (!res.headersSent) fail(502, `Bağlanılamadı: ${url.hostname}`);
        else res.destroy();
      });
      req.pipe(up);
    })();
  });

  return {
    /** Bir oturum için çıkış kimliği kaydeder (üzerine yazar). */
    register(id: string, secret: string, policy: EgressPolicy): void {
      const prev = entries.get(id);
      entries.set(id, { secret, policy, active: prev?.active ?? 0, denied: prev?.denied ?? 0 });
    },
    unregister(id: string): void {
      entries.delete(id);
    },
    stats: (id: string) => {
      const e = entries.get(id);
      return e ? { active: e.active, denied: e.denied } : null;
    },
    listen: (port: number, host: string) =>
      new Promise<number>((res, rej) => {
        server.once('error', rej);
        server.listen(port, host, () => res((server.address() as net.AddressInfo).port));
      }),
    close: () =>
      new Promise<void>((res) => {
        server.closeAllConnections?.();
        server.close(() => res());
      }),
  };
}
export type EgressProxy = ReturnType<typeof createEgressProxy>;
