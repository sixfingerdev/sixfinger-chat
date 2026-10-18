/**
 * Asistan metnindeki zengin bloklar (artifact ve widget) ve bunların güvenli çalıştırma belgesi.
 *
 *   <artifact id="yilan" type="html" title="Yılan Oyunu"> … </artifact>   → ayrı belge (yan panel / tam ekran)
 *   <widget title="Faiz hesaplayıcı" height="320"> … </widget>             → mesaj içinde küçük etkileşimli parça
 *
 * Etiketler metnin içinde akar; böylece içerik token token gelir, geçmişe düz metin olarak girer ve
 * uzun HTML'i JSON argümanına kaçışlama derdi olmaz. Akış sırasında yarım kalan bloklar `closed: false` döner.
 */

import { WIDGET_KIT_JS, widgetKitCss } from './widget-kit.ts';

export const ARTIFACT_KINDS = ['html', 'svg', 'markdown', 'mermaid'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type RichSegment =
  | { type: 'markdown'; text: string }
  | { type: 'artifact'; id: string; title: string; kind: ArtifactKind; content: string; closed: boolean }
  | { type: 'widget'; title: string; content: string; closed: boolean; height: number | null };

const OPEN = /```|<artifact\b[^>]*>|<widget\b[^>]*>/g;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  return out;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** İçeriği çevreleyen tek bir ``` çitini (modelin sık yaptığı) soyar. */
function unfence(content: string): string {
  const t = content.trim();
  const m = /^```[\w+-]*\n([\s\S]*?)\n?```$/.exec(t);
  return (m ? m[1]! : t).replace(/^\n+|\n+$/g, '');
}

/** Metnin sonunda henüz tamamlanmamış bir `<artifact`/`<widget` başlangıcı varsa (akış sırasında) onu ayırır. */
function holdBack(text: string): string {
  const lt = text.lastIndexOf('<');
  if (lt < 0) return text;
  const tail = text.slice(lt);
  if (tail.includes('>')) return text;
  // Etiket adı hâlâ yazılıyor (boşluk yok): "<", "<art", "<widg" …
  const partial = !/\s/.test(tail) && tail.length <= 9 && ('<artifact'.startsWith(tail) || '<widget'.startsWith(tail));
  return partial || /^<(artifact|widget)\b/.test(tail) ? text.slice(0, lt) : text;
}

/**
 * Küçük modeller etiketi bazen ``` çitiyle sarar. Çit doğrudan bir artifact/widget etiketiyle başlıyorsa
 * (ve onu kapatıyorsa) çiti soyarız; başka metin içeren kod blokları olduğu gibi kalır.
 */
function stripWrappingFences(text: string): string {
  if (!text.includes('```')) return text;
  return text
    .replace(/```[\w+-]*[ \t]*\n[ \t]*(?=<(?:artifact|widget)\b)/g, '')
    .replace(/(<\/(?:artifact|widget)>)[ \t]*\n?[ \t]*```/g, '$1');
}

export function parseRich(input: string): RichSegment[] {
  const text = stripWrappingFences(input);
  const out: RichSegment[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    // Çitli kod bloklarının içindeki etiketleri atlayarak sıradaki açılış etiketini bul.
    OPEN.lastIndex = i;
    let inFence = false;
    let found: RegExpExecArray | null = null;
    for (let m = OPEN.exec(text); m; m = OPEN.exec(text)) {
      if (m[0] === '```') inFence = !inFence;
      else if (!inFence) {
        found = m;
        break;
      }
    }
    if (!found) {
      const rest = holdBack(text.slice(i));
      if (rest) out.push({ type: 'markdown', text: rest });
      break;
    }
    const before = text.slice(i, found.index);
    if (before) out.push({ type: 'markdown', text: before });

    const tag = found[0];
    const bodyStart = found.index + tag.length;
    const isArtifact = tag.startsWith('<artifact');
    const closeTag = isArtifact ? '</artifact>' : '</widget>';
    const closeIdx = text.indexOf(closeTag, bodyStart);
    const closed = closeIdx >= 0;
    const content = unfence(text.slice(bodyStart, closed ? closeIdx : text.length));
    const a = attrs(tag);
    if (isArtifact) {
      const kind = (ARTIFACT_KINDS as readonly string[]).includes(a.type ?? '') ? (a.type as ArtifactKind) : 'html';
      const title = a.title || 'Artifact';
      out.push({ type: 'artifact', id: slug(a.id || '') || slug(title) || `artifact-${++n}`, title, kind, content, closed });
    } else {
      const h = Number(a.height);
      out.push({ type: 'widget', title: a.title || '', content, closed, height: Number.isFinite(h) && h > 0 ? Math.min(Math.round(h), 900) : null });
    }
    i = closed ? closeIdx + closeTag.length : text.length;
  }
  return out;
}

// ---------- Artifact sürümleri ----------
export interface ArtifactVersion {
  content: string;
  closed: boolean;
  /** Bu sürümün geldiği mesajın sıra numarası (verilen listedeki indeks). */
  messageIndex: number;
}

export interface ArtifactEntry {
  id: string;
  title: string;
  kind: ArtifactKind;
  versions: ArtifactVersion[];
}

/** Aktif yoldaki mesaj metinlerinden artifact'ları toplar: aynı `id` yeni sürüm sayılır. */
export function collectArtifacts(texts: string[]): ArtifactEntry[] {
  const map = new Map<string, ArtifactEntry>();
  texts.forEach((t, messageIndex) => {
    if (!t.includes('<artifact')) return;
    for (const seg of parseRich(t)) {
      if (seg.type !== 'artifact') continue;
      const e = map.get(seg.id) ?? { id: seg.id, title: seg.title, kind: seg.kind, versions: [] };
      e.title = seg.title;
      e.kind = seg.kind;
      e.versions.push({ content: seg.content, closed: seg.closed, messageIndex });
      map.set(seg.id, e);
    }
  });
  return [...map.values()];
}

// ---------- Güvenli çalıştırma belgesi ----------
const CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com'];

/**
 * Yalnızca bu üç CDN'den betik/stil/font yüklenebilir; sayfa hiçbir yere veri gönderemez
 * (connect-src CDN ile sınırlı, form ve iç içe çerçeve kapalı). Uygulamanın kaynağına hiç erişemez
 * çünkü belge `sandbox="allow-scripts"` ile (aynı kaynak OLMADAN) çalıştırılır.
 */
export const SANDBOX_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDNS.join(' ')}`,
  `style-src 'unsafe-inline' ${CDNS.join(' ')} https://fonts.googleapis.com`,
  `font-src data: ${CDNS.join(' ')} https://fonts.gstatic.com`,
  `img-src data: blob: ${CDNS.join(' ')}`,
  'media-src data: blob:',
  `connect-src ${CDNS.join(' ')}`,
  'worker-src blob:',
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export interface SandboxDocOptions {
  kind: ArtifactKind;
  content: string;
  /** Uygulama teması: --sf-* CSS değişkenleri olarak enjekte edilir. */
  vars: Record<string, string>;
  dark: boolean;
  /** Widget: içerik yüksekliğini üst pencereye bildirir (zaten her zaman bildirir; üst taraf kullanır). */
  mode: 'artifact' | 'widget';
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function prelude(vars: Record<string, string>, dark: boolean, mode: 'artifact' | 'widget'): string {
  const css = Object.entries(vars)
    .map(([k, v]) => `--sf-${k}:${v.replace(/[;{}<>]/g, '')}`)
    .join(';');
  const bg = vars.bg ?? (dark ? '#0b0b0c' : '#fafaf9');
  const fg = vars.text ?? (dark ? '#f4f4f5' : '#0b0b0c');
  return (
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
    `<meta name="color-scheme" content="${dark ? 'dark' : 'light'}">` +
    `<style>:root{${css};color-scheme:${dark ? 'dark' : 'light'}}` +
    `html,body{margin:0;${mode === 'widget' ? 'background:transparent;' : `background:${bg};`}color:${fg};` +
    `font-family:var(--sf-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);-webkit-text-size-adjust:100%}</style>` +
    `<script>(function(){var post=function(m){m.sf=1;try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m))}else{parent.postMessage(m,'*')}}catch(e){}};` +
    `window.sf={sendPrompt:function(t){post({type:'prompt',text:String(t).slice(0,2000)})}};` +
    `var last=0;function h(){var b=document.body,d=document.documentElement;var v=Math.ceil(Math.max(b?b.scrollHeight:0,d.scrollHeight));if(v!==last){last=v;post({type:'height',h:v})}}` +
    `addEventListener('load',h);addEventListener('resize',h);` +
    `if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}else{setInterval(h,500)}` +
    `addEventListener('error',function(e){post({type:'error',message:String(e.message||e)})});` +
    `window.addEventListener('unhandledrejection',function(e){post({type:'error',message:String(e.reason)})});` +
    `})();</script>` +
    `<style>${widgetKitCss(dark)}</style>` +
    `<script>${WIDGET_KIT_JS}document.documentElement.classList.add('sf-${mode}');</script>`
  );
}

/** Artifact/widget içeriğini, CSP ve köprü betiğiyle donatılmış tam bir HTML belgesine çevirir. */
export function buildSandboxDoc({ kind, content, vars, dark, mode }: SandboxDocOptions): string {
  const head = prelude(vars, dark, mode);
  if (kind === 'svg') {
    return `<!doctype html><html><head><meta charset="utf-8">${head}<style>body{display:grid;place-items:center;min-height:100vh}svg{max-width:100%;height:auto}</style></head><body>${content}</body></html>`;
  }
  if (kind === 'mermaid') {
    const theme = dark ? 'dark' : 'default';
    return (
      `<!doctype html><html><head><meta charset="utf-8">${head}<style>body{display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}</style></head><body>` +
      `<pre class="mermaid">${escapeHtml(content)}</pre>` +
      `<script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:true,theme:'${theme}',securityLevel:'strict'});</script></body></html>`
    );
  }
  // html: tam belge ya da parça olabilir.
  const hasHead = /<head[\s>]/i.test(content);
  if (hasHead) return content.replace(/<head([^>]*)>/i, (m) => `${m}<meta charset="utf-8">${head}`);
  if (/<html[\s>]/i.test(content)) return content.replace(/<html([^>]*)>/i, (m) => `${m}<head><meta charset="utf-8">${head}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${content}</body></html>`;
}

/** Köprüden gelen mesajı doğrular (yalnızca bizim biçimimiz kabul edilir). */
export type SandboxMessage =
  | { sf: 1; type: 'height'; h: number }
  | { sf: 1; type: 'prompt'; text: string }
  | { sf: 1; type: 'error'; message: string };

export function parseSandboxMessage(data: unknown): SandboxMessage | null {
  let d = data;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  if (m.sf !== 1) return null;
  if (m.type === 'height' && typeof m.h === 'number' && Number.isFinite(m.h)) return { sf: 1, type: 'height', h: Math.max(0, Math.min(Math.round(m.h), 4000)) };
  if (m.type === 'prompt' && typeof m.text === 'string' && m.text.trim()) return { sf: 1, type: 'prompt', text: m.text.slice(0, 2000) };
  if (m.type === 'error' && typeof m.message === 'string') return { sf: 1, type: 'error', message: m.message.slice(0, 300) };
  return null;
}
