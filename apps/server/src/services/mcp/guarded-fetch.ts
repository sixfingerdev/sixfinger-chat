import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { parseSafeUrl, safeLookup, USER_AGENT } from '../tools/net.ts';
import { ToolError } from '../tools/errors.ts';

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

const NO_BODY = new Set([101, 204, 205, 304]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function toBuffer(body: RequestInit['body']): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new ToolError('Desteklenmeyen istek gövdesi.');
}

function open(url: URL, method: string, headers: Record<string, string>, body: Buffer | undefined, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        agent: false,
        lookup: safeLookup as never,
        signal,
        headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'identity', ...headers, ...(body ? { 'content-length': String(body.length) } : {}) },
      },
      resolve,
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * MCP sunucularına giden istekler için SSRF korumalı, AKIŞLI fetch (SSE yanıtları tamponlanmaz).
 * Yalnızca https; özel/yerel adresler ve yasak portlar `parseSafeUrl`/`safeLookup` ile reddedilir; çözümlenen TÜM adresler denetlenir.
 * Yönlendirmeler (en çok 3) her adımda baştan doğrulanır.
 */
export function createGuardedFetch(): FetchLike {
  return async (input, init = {}) => {
    let url = parseSafeUrl(typeof input === 'string' ? input : input.toString());
    if (url.protocol !== 'https:') throw new ToolError('MCP sunucuları yalnızca https üzerinden bağlanabilir.');
    let method = (init.method ?? 'GET').toUpperCase();
    let body = toBuffer(init.body);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const signal = init.signal ?? new AbortController().signal;

    for (let hop = 0; hop <= 3; hop++) {
      let res: http.IncomingMessage;
      try {
        res = await open(url, method, headers, body, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBLOCKED') throw new ToolError('Bu adrese erişim engellendi.');
        if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new ToolError('Alan adı bulunamadı.');
        throw new ToolError('MCP sunucusuna bağlanılamadı.');
      }
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (REDIRECTS.has(status) && location) {
        res.resume();
        const next = parseSafeUrl(new URL(location, url).toString());
        if (next.protocol !== 'https:') throw new ToolError('MCP yönlendirmesi https olmalı.');
        if (new URL(location, url).origin !== url.origin) {
          // Kimlik bilgileri başka kaynağa sızmasın.
          delete headers.authorization;
          delete headers.cookie;
        }
        if (status === 301 || status === 302 || status === 303) {
          method = 'GET';
          body = undefined;
          delete headers['content-type'];
        }
        url = next;
        continue;
      }
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) for (const x of v) h.append(k, x);
        else if (v !== undefined) h.set(k, v);
      }
      const stream = NO_BODY.has(status) ? null : (Readable.toWeb(res) as unknown as ReadableStream);
      if (!stream) res.resume();
      return new Response(stream, { status, statusText: res.statusMessage ?? '', headers: h });
    }
    throw new ToolError('Çok fazla yönlendirme.');
  };
}
