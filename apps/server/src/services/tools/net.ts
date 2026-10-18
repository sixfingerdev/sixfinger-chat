import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { ToolError } from './errors.ts';

/**
 * Dışarı açılan tüm istekler buradan geçer. Amaç SSRF'yi engellemek: model (ya da bir sayfa)
 * `http://192.168.1.1`, `http://localhost:5432`, bulut metadata adresleri gibi iç ağ hedeflerine
 * istek attıramaz. Kontrol hem URL'de hem de BAĞLANTI ANINDA yapılır (DNS yeniden bağlamaya karşı).
 */

const blocked = new net.BlockList();
const V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const V6: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];
for (const [a, p] of V4) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of V6) blocked.addSubnet(a, p, 'ipv6');

/** `::ffff:a.b.c.d` ya da `::ffff:7f00:1` biçimindeki IPv4-eşlemeli adresleri IPv4'e çevirir. */
function unmap(ip: string): string {
  const lower = ip.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return ip;
}

export function isBlockedIp(raw: string): boolean {
  const ip = unmap(raw.replace(/^\[|\]$/g, ''));
  const family = net.isIP(ip);
  if (family === 0) return true; // anlaşılamayan her şey engellenir
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.arpa', '.corp', '.intranet', '.private'];

export function parseSafeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ToolError('Geçersiz adres.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ToolError('Yalnızca http ve https adresleri açılabilir.');
  if (url.username || url.password) throw new ToolError('Kullanıcı bilgisi içeren adresler açılamaz.');
  if (!ALLOWED_PORTS.has(url.port)) throw new ToolError('Bu bağlantı noktasına erişim engellendi.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) throw new ToolError('Geçersiz adres.');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new ToolError('Bu adrese erişim engellendi.');
  } else {
    if (host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new ToolError('Bu adrese erişim engellendi.');
    }
  }
  return url;
}

/** Çözümlenen TÜM adresler güvenli değilse bağlanmayı reddeden DNS çözücü. */
export function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return callback(err, '' as never);
    if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
      const e: NodeJS.ErrnoException = new Error('Bu adrese erişim engellendi.');
      e.code = 'EBLOCKED';
      return callback(e, '' as never);
    }
    if (options.all) return callback(null, addrs);
    callback(null, addrs[0]!.address, addrs[0]!.family);
  });
}

export interface SafeResponse {
  status: number;
  url: string;
  contentType: string;
  body: Buffer;
  /** Gövde `maxBytes`'ı aştığı için kesildi. */
  truncated: boolean;
}

export interface SafeFetchOptions {
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const USER_AGENT = 'Mozilla/5.0 (compatible; SixFingerBot/1.0; +https://chat.sixfinger.live)';

function request(url: URL, signal: AbortSignal, headers: Record<string, string>): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        lookup: safeLookup as never,
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.8,*/*;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
          ...headers,
        },
      },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

function decoded(res: http.IncomingMessage): Readable {
  const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let url = parseSafeUrl(input);

  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    let res: http.IncomingMessage;
    try {
      res = await request(url, signal, opts.headers ?? {});
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EBLOCKED') throw new ToolError('Bu adrese erişim engellendi.');
      if (timeout.aborted || code === 'ABORT_ERR') throw new ToolError('Sayfa zamanında yanıt vermedi.');
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new ToolError('Alan adı bulunamadı.');
      throw new ToolError('Sayfaya bağlanılamadı.');
    }

    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (REDIRECTS.has(status) && location) {
      res.resume();
      url = parseSafeUrl(new URL(location, url).toString()); // her yönlendirme baştan doğrulanır
      continue;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    const body = decoded(res);
    try {
      for await (const chunk of body) {
        const buf = chunk as Buffer;
        if (size + buf.length > maxBytes) {
          chunks.push(buf.subarray(0, maxBytes - size));
          size = maxBytes;
          truncated = true;
          break;
        }
        chunks.push(buf);
        size += buf.length;
      }
    } catch {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (!chunks.length) throw new ToolError('Sayfa okunamadı.');
      truncated = true;
    } finally {
      res.destroy();
    }
    return {
      status,
      url: url.toString(),
      contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
      body: Buffer.concat(chunks),
      truncated,
    };
  }
  throw new ToolError('Çok fazla yönlendirme.');
}
