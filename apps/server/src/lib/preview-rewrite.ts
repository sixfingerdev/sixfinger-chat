/**
 * Önizleme yanıtlarında köke göre yazılmış bağlantıları (`/app.js`) önizleme önekine (`/api/code/preview/<token>`) çevirir.
 * Önizleme bir yol öneki altında sunulduğu için bu bağlantılar yoksa API köküne giderdi. Yalnızca yaygın, güvenli kalıplar
 * değiştirilir; kodun içindeki rastgele `"/x"` metinleri (ör. fetch('/api')) değiştirilemez.
 */
const ATTR = /(\s(?:src|href|action|poster|formaction|data-src)\s*=\s*)(["'])\/(?!\/)/gi;
const SRCSET = /(\s(?:srcset|imagesrcset)\s*=\s*)(["'])(.*?)\2/gis;
const CSS_URL = /url\(\s*(["']?)\/(?!\/)/g;
const CSS_IMPORT = /(@import\s+)(["'])\/(?!\/)/g;
const JS_SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])\/(?!\/)/g;

export function rewriteCss(css: string, prefix: string): string {
  return css.replace(CSS_URL, `url($1${prefix}/`).replace(CSS_IMPORT, `$1$2${prefix}/`);
}

export function rewriteHtml(html: string, prefix: string): string {
  const withSrcset = html.replace(SRCSET, (_m, a: string, q: string, v: string) => `${a}${q}${v.replace(/(^|,\s*)\/(?!\/)/g, `$1${prefix}/`)}${q}`);
  return rewriteCss(withSrcset.replace(ATTR, `$1$2${prefix}/`), prefix);
}

/** ES modül içe aktarmaları (`import x from "/src/a.js"`, `import("/b.js")`): dev-server çıktıları için. */
export function rewriteJs(js: string, prefix: string): string {
  return js.replace(JS_SPEC, `$1$2${prefix}/`);
}

/** Yönlendirme (`Location`) başlığı: köke göre ya da yerel dev-server adresi ise önizleme önekine çevrilir. */
export function rewriteLocation(loc: string, prefix: string): string {
  if (/^\/(?!\/)/.test(loc)) return `${prefix}${loc}`;
  const m = /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(\/.*)?$/i.exec(loc);
  return m ? `${prefix}${m[1] ?? '/'}` : loc;
}
