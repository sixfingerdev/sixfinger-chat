import { posix } from 'node:path';
import type { CodePreviewDTO } from '@sixfinger/shared';
import { HttpError, notFound } from '../lib/errors.ts';
import { mimeOf } from '../lib/mime.ts';
import { rewriteCss, rewriteHtml, rewriteJs, rewriteLocation } from '../lib/preview-rewrite.ts';
import type { SecretBox } from '../lib/secretbox.ts';
import type { AuthUser } from '../lib/types.ts';
import type { Code } from './code.ts';
import type { CodeGit } from './code-git.ts';
import { ToolError } from './tools/errors.ts';
import { FileNotFoundError, IsDirectoryError } from './tools/code-client.ts';

/** Token ömrü: bir önizleme sayfası bu süre boyunca varlıklarını yükleyebilir; sonra yenisi alınır. */
const TOKEN_TTL_SECONDS = 3 * 3600;
const STATIC_MAX_MB = 8;
const REWRITE_MAX_BYTES = 4 * 1_048_576;

interface Claims extends Record<string, unknown> {
  /** Amaç işareti: OAuth `state` gibi başka imzalı değerler önizleme token'ı olarak kabul edilmez. */
  k: 'pv';
  u: string;
  c: string;
  f: 'file' | 'port';
  /** Statik önizleme kökü (çalışma alanına göre, `''` = repo kökü). */
  r: string;
  p?: number;
}

export interface PreviewReply {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface PreviewRequest {
  method: string;
  /** Token'dan sonraki yol (çözülmüş). */
  rest: string;
  /** Ham sorgu dizesi (`?` olmadan). */
  query: string;
  headers: Record<string, string>;
  body?: Buffer;
  /** `/api/code/preview/<token>`: HTML/CSS/JS içindeki köke göre bağlantılar bu önekle yeniden yazılır. */
  prefix: string;
}

const page = (status: number, title: string, message: string): PreviewReply => ({
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: Buffer.from(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font:15px/1.5 system-ui;background:#111;color:#ddd;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center">` +
      `<div><h3 style="margin:0 0 8px;color:#fff">${title}</h3><p style="margin:0;max-width:46ch">${message.replace(/</g, '&lt;')}</p></div>`,
  ),
});

/** Statik yolu köke göre güvenle çözer; kökten çıkan ya da şüpheli yollar null döner. */
export function resolveStatic(root: string, rest: string): string | null {
  if (rest.includes('\0') || rest.includes('\\')) return null;
  const clean = posix.normalize(`/${rest}`).slice(1);
  if (clean === '..' || clean.startsWith('../') || rest.split('/').includes('..')) return null;
  return root ? posix.join(root, clean) : clean || '.';
}

/**
 * Önizleme: (1) çalışma alanındaki dosyaların statik sunumu (çok dosyalı artifact: index.html + js/css/varlıklar) ve
 * (2) konteynerde çalışan bir dev-server'ın HTTP proxy'si. Adres, oturum + kök/port için imzalı kısa ömürlü bir token taşır;
 * böylece iframe/WebView başlık göndermeden açabilir. Yanıtlar `Content-Security-Policy: sandbox` ile yalıtılır (rota katmanında).
 */
export function createCodePreview(deps: { codeGit: CodeGit; secrets: SecretBox | null; code: Code }) {
  const { codeGit, secrets, code } = deps;

  async function mint(user: AuthUser, chatId: string, spec: { path?: string; port?: number; root?: string }): Promise<CodePreviewDTO> {
    if (!secrets) throw new HttpError(503, 'upstream_unavailable', 'Code bu sunucuda ayarlanmamış.');
    if (!(await code.getSession(user.id, chatId))) throw notFound('Oturum bulunamadı.');
    const base = { k: 'pv' as const, u: user.id, c: chatId };
    const ttl = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

    if (spec.port) {
      const ports = await codeGit.sandboxPorts(user, chatId).catch(() => [] as number[]);
      if (!ports.includes(spec.port)) {
        throw new HttpError(409, 'conflict', `Port ${spec.port} üzerinde çalışan bir sunucu yok. Sunucu arka planda çalışıyor olmalı.`);
      }
      const token = secrets.signState({ ...base, f: 'port', r: '', p: spec.port } satisfies Claims, TOKEN_TTL_SECONDS);
      return { url: `/api/code/preview/${token}/`, expiresAt: ttl, kind: 'port', entry: spec.port };
    }

    let entry = posix.normalize(spec.path!.replace(/^\/work\//, '').replace(/^\.\//, ''));
    if (entry.startsWith('/') || entry === '..' || entry.startsWith('../')) throw new HttpError(400, 'bad_request', 'Yol çalışma alanı içinde olmalı.');
    let root = spec.root !== undefined ? posix.normalize(spec.root.replace(/^\/work\//, '').replace(/^\.\//, '')).replace(/^\.$/, '') : undefined;
    if (root !== undefined && (root.startsWith('/') || root === '..' || root.startsWith('../'))) throw new HttpError(400, 'bad_request', 'Kök çalışma alanı içinde olmalı.');
    try {
      await codeGit.sandboxFile(user, chatId, entry, STATIC_MAX_MB);
    } catch (err) {
      if (err instanceof IsDirectoryError) {
        root ??= entry === '.' ? '' : entry;
        entry = posix.join(entry, 'index.html');
        await codeGit.sandboxFile(user, chatId, entry, STATIC_MAX_MB).catch((e) => {
          throw e instanceof FileNotFoundError ? new HttpError(404, 'not_found', `${entry} yok; önizlemek için bir HTML dosyası ver.`) : e;
        });
      } else if (err instanceof FileNotFoundError) throw notFound(`Dosya bulunamadı: ${entry}`);
      else if (err instanceof ToolError) throw new HttpError(400, 'bad_request', err.message);
      else throw err;
    }
    root ??= posix.dirname(entry) === '.' ? '' : posix.dirname(entry);
    if (root && entry !== root && !entry.startsWith(`${root}/`)) throw new HttpError(400, 'bad_request', 'Giriş dosyası kök klasörün içinde olmalı.');
    const rel = root ? entry.slice(root.length + 1) : entry;
    const token = secrets.signState({ ...base, f: 'file', r: root } satisfies Claims, TOKEN_TTL_SECONDS);
    return { url: `/api/code/preview/${token}/${rel.split('/').map(encodeURIComponent).join('/')}`, expiresAt: ttl, kind: 'file', entry };
  }

  const NOT_FOUND = (what: string) => page(404, 'Bulunamadı', what);

  async function serveStatic(claims: Claims, r: PreviewRequest): Promise<PreviewReply> {
    if (r.method !== 'GET' && r.method !== 'HEAD') return page(405, 'İzin verilmiyor', 'Statik önizleme yalnızca GET destekler.');
    let rel = r.rest;
    const dirLike = rel === '' || rel.endsWith('/');
    if (dirLike) rel = `${rel}index.html`;
    const path = resolveStatic(claims.r, rel);
    if (!path) return page(400, 'Geçersiz yol', 'Bu yol önizleme kökünün dışına çıkıyor.');
    const user = { id: claims.u };
    let data: Buffer;
    try {
      data = await codeGit.sandboxFile(user, claims.c, path, STATIC_MAX_MB);
    } catch (err) {
      if (err instanceof IsDirectoryError) return { status: 302, headers: { location: `${r.prefix}/${r.rest.replace(/\/?$/, '/')}`, 'content-type': 'text/plain' }, body: Buffer.alloc(0) };
      if (err instanceof FileNotFoundError) return NOT_FOUND(dirLike ? 'Bu klasörde index.html yok.' : `${rel} dosyası çalışma alanında yok.`);
      if (err instanceof HttpError) return page(err.status, 'Önizleme açılamadı', err.message);
      if (err instanceof ToolError) return page(502, 'Önizleme açılamadı', err.message);
      throw err;
    }
    const type = mimeOf(path);
    return { status: 200, headers: { 'content-type': type }, body: rewriteBody(type, data, r.prefix, false) };
  }

  function rewriteBody(type: string, data: Buffer, prefix: string, js: boolean): Buffer {
    if (data.length > REWRITE_MAX_BYTES) return data;
    if (type.startsWith('text/html')) return Buffer.from(rewriteHtml(data.toString('utf8'), prefix));
    if (type.startsWith('text/css')) return Buffer.from(rewriteCss(data.toString('utf8'), prefix));
    if (js && /javascript/.test(type)) return Buffer.from(rewriteJs(data.toString('utf8'), prefix));
    return data;
  }

  async function serveProxy(claims: Claims, r: PreviewRequest): Promise<PreviewReply> {
    const path = `/${r.rest}${r.query ? `?${r.query}` : ''}`;
    let up;
    try {
      up = await codeGit.sandboxHttp({ id: claims.u }, claims.c, { port: claims.p!, method: r.method, path, headers: r.headers, body: r.body });
    } catch (err) {
      if (err instanceof FileNotFoundError) return page(502, 'Sunucu çalışmıyor', err.message);
      if (err instanceof HttpError) return page(err.status, 'Önizleme açılamadı', err.message);
      if (err instanceof ToolError) return page(502, 'Önizleme açılamadı', err.message);
      throw err;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of up.headers) {
      if (k === 'set-cookie' || k === 'content-security-policy' || k === 'content-security-policy-report-only' || k === 'x-frame-options' || k === 'strict-transport-security') continue;
      headers[k] = k === 'location' ? rewriteLocation(v, r.prefix) : v;
    }
    const type = headers['content-type'] ?? mimeOf(r.rest);
    headers['content-type'] = type;
    return { status: up.status, headers, body: rewriteBody(type, up.body, r.prefix, true) };
  }

  /** Token'ı doğrular ve isteği statik dosyadan ya da dev-server'dan karşılar. Hata sayfaları da yanıt olarak döner. */
  async function serve(token: string, r: PreviewRequest): Promise<PreviewReply> {
    const claims = secrets?.verifyState<Claims>(token);
    if (!claims || claims.k !== 'pv' || (claims.f !== 'port' && claims.f !== 'file')) {
      return page(404, 'Bağlantının süresi doldu', 'Önizleme bağlantısı geçersiz ya da süresi dolmuş. Mesajdaki önizleme düğmesinden yeniden aç.');
    }
    return claims.f === 'port' ? serveProxy(claims, r) : serveStatic(claims, r);
  }

  return { mint, serve };
}
export type CodePreview = ReturnType<typeof createCodePreview>;
