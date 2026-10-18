/**
 * Widget/artifact tasarım seti: modelin yazdığı HTML'e tutarlı, uygulamayla uyumlu bir görünüm verir.
 *
 * İki katman:
 *  1) Taban stiller `:where()` içinde (özgüllük 0): hiç stil yazılmamış düğme, giriş, kaydırıcı, tablo, başlık
 *     bile düzgün görünür; modelin kendi CSS'i her zaman kazanır.
 *  2) `sf-*` sınıfları: kart, istatistik, alan, çip, ilerleme çubuğu, açıklama kutusu, ızgara…
 *
 * Renkler ana uygulamadan gelen --sf-* değişkenleridir (bg, surface, surface2, line, text, text2, text3, accent, font, mono);
 * grafik serileri ve anlam renkleri aşağıda koyu/açık tema için ayrı ayrı tanımlıdır.
 */

interface Palette {
  c2: string;
  c3: string;
  c4: string;
  c5: string;
  good: string;
  bad: string;
  warn: string;
}

// Ana vurgu (c1) monokrom; diğer seriler onunla ve birbiriyle ayırt edilebilir kalacak şekilde seçildi, her iki zeminde de okunur.
const DARK: Palette = { c2: '#6aa8ff', c3: '#3ccf7e', c4: '#b99cff', c5: '#f5b53d', good: '#3ccf7e', bad: '#f2554d', warn: '#f5b53d' };
const LIGHT: Palette = { c2: '#1d63c9', c3: '#1c9a58', c4: '#7a3fd0', c5: '#b97a06', good: '#1c9a58', bad: '#d6372f', warn: '#b97a06' };

export function widgetKitCss(dark: boolean): string {
  const p = dark ? DARK : LIGHT;
  const onAccent = dark ? '#0b0b0c' : '#ffffff';
  return `
:root{--sf-c1:var(--sf-accent);--sf-c2:${p.c2};--sf-c3:${p.c3};--sf-c4:${p.c4};--sf-c5:${p.c5};
--sf-good:${p.good};--sf-bad:${p.bad};--sf-warn:${p.warn};--sf-on-accent:${onAccent};
--sf-accent-soft:color-mix(in srgb,var(--sf-accent) 14%,transparent);
--sf-r:14px;--sf-r-sm:10px;--sf-ease:cubic-bezier(.22,1,.36,1)}
:where(html){font:14px/1.5 var(--sf-font,system-ui,sans-serif);color:var(--sf-text);-webkit-font-smoothing:antialiased}
:where(.sf-widget body){padding:14px 16px}
:where(*){box-sizing:border-box}
:where(h1,h2,h3,h4){margin:0 0 .45em;font-weight:620;line-height:1.2;letter-spacing:-.012em;text-wrap:balance;color:var(--sf-text)}
:where(h1){font-size:22px}:where(h2){font-size:18px}:where(h3){font-size:15px}:where(h4){font-size:13px}
:where(p){margin:0 0 .75em;color:var(--sf-text2);line-height:1.55}
:where(small){color:var(--sf-text3);font-size:12.5px}
:where(a){color:var(--sf-accent)}
:where(b,strong){font-weight:620;color:var(--sf-text)}
:where(code,kbd,samp,pre){font-family:var(--sf-mono,ui-monospace,monospace);font-size:.92em}
:where(code){background:var(--sf-surface2);padding:.1em .38em;border-radius:6px}
:where(pre){background:var(--sf-surface2);padding:12px 14px;border-radius:var(--sf-r-sm);overflow:auto}
:where(hr){border:0;height:1px;background:var(--sf-line);margin:12px 0}
:where(ul,ol){margin:0 0 .75em;padding-left:1.2em;color:var(--sf-text2)}
:where(li){margin:.2em 0}
:where(svg){max-width:100%;height:auto}
:where(button){font:inherit;font-weight:560;color:var(--sf-text);background:var(--sf-surface2);border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);padding:7px 14px;min-height:36px;cursor:pointer;transition:transform .12s var(--sf-ease),border-color .12s,background .12s}
:where(button:hover){border-color:color-mix(in srgb,var(--sf-text) 30%,var(--sf-line))}
:where(button:active){transform:scale(.97)}
:where(button:disabled){opacity:.45;cursor:not-allowed}
:where(button.primary,.sf-primary){background:var(--sf-accent);border-color:transparent;color:var(--sf-on-accent)}
:where(button.primary:hover,.sf-primary:hover){background:color-mix(in srgb,var(--sf-accent) 88%,#fff)}
:where(input,select,textarea){font:inherit;color:var(--sf-text);background:var(--sf-surface);border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);padding:7px 10px;min-height:36px;max-width:100%}
:where(input[type=number],input[type=text],input[type=search],select){font-variant-numeric:tabular-nums}
:where(button,input,select,textarea):focus-visible{outline:2px solid var(--sf-accent);outline-offset:2px}
:where(input[type=checkbox],input[type=radio]){accent-color:var(--sf-accent);min-height:0;width:16px;height:16px}
:where(input[type=range]){-webkit-appearance:none;appearance:none;width:100%;height:22px;padding:0;margin:0;border:0;min-height:0;background:transparent;cursor:pointer;--p:50%}
:where(input[type=range])::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(90deg,var(--sf-accent) var(--p),var(--sf-line) var(--p))}
:where(input[type=range])::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-7px;border-radius:50%;background:var(--sf-text);border:0;box-shadow:0 0 0 3px var(--sf-accent-soft),0 1px 3px rgba(0,0,0,.35)}
:where(input[type=range])::-moz-range-track{height:4px;border-radius:2px;background:var(--sf-line)}
:where(input[type=range])::-moz-range-progress{height:4px;border-radius:2px;background:var(--sf-accent)}
:where(input[type=range])::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--sf-text);border:0}
:where(table){width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
:where(th){padding:8px 10px;text-align:left;font-size:11px;font-weight:620;letter-spacing:.09em;text-transform:uppercase;color:var(--sf-text3);border-bottom:1px solid var(--sf-line)}
:where(td){padding:9px 10px;border-bottom:1px solid var(--sf-line);color:var(--sf-text)}
:where(tr:last-child td){border-bottom:0}
:where(output,.num){font-variant-numeric:tabular-nums}
:where(details){border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);padding:8px 12px}
:where(summary){cursor:pointer;font-weight:560}

.sf-card{background:var(--sf-surface);border:1px solid var(--sf-line);border-radius:var(--sf-r);padding:14px 16px}
.sf-stack{display:flex;flex-direction:column;gap:12px}
.sf-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.sf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
.sf-between{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.sf-label{font-size:11px;font-weight:620;letter-spacing:.09em;text-transform:uppercase;color:var(--sf-text3)}
.sf-title{display:flex;align-items:center;gap:9px;margin:0 0 10px;font-size:15px;font-weight:620;color:var(--sf-text)}
.sf-title::before{content:"";width:3px;height:1.05em;background:var(--sf-accent);transform:skewX(-16deg);border-radius:1px}
.sf-muted{color:var(--sf-text3);font-size:12.5px}
.sf-field{display:flex;flex-direction:column;gap:6px}
.sf-field-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;color:var(--sf-text2)}
.sf-field-head output,.sf-field-head b{color:var(--sf-text);font-weight:620;font-variant-numeric:tabular-nums}
.sf-stat{display:flex;flex-direction:column;gap:3px;min-width:0}
.sf-stat .v{font-size:clamp(19px,6vw,28px);white-space:nowrap;font-weight:650;letter-spacing:-.022em;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--sf-text)}
.sf-stat .l{font-size:11px;font-weight:620;letter-spacing:.09em;text-transform:uppercase;color:var(--sf-text3)}
.sf-stat .d{font-size:12.5px;color:var(--sf-text3);font-variant-numeric:tabular-nums}
.sf-stat .d.up{color:var(--sf-good)}.sf-stat .d.down{color:var(--sf-bad)}
.sf-chip{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 11px;border-radius:14px;background:var(--sf-surface2);border:1px solid var(--sf-line);font-size:12.5px;color:var(--sf-text2);cursor:default}
button.sf-chip{cursor:pointer;min-height:28px;padding:0 11px;font-weight:500}
.sf-chip.on,.sf-chip[aria-pressed=true]{background:var(--sf-accent-soft);border-color:var(--sf-accent);color:var(--sf-accent)}
.sf-bar{height:6px;border-radius:3px;background:var(--sf-line);overflow:hidden}
.sf-bar>i{display:block;height:100%;border-radius:3px;background:var(--sf-accent);transition:width .3s var(--sf-ease)}
.sf-callout{padding:10px 12px;border-radius:var(--sf-r-sm);background:var(--sf-accent-soft);color:var(--sf-text);font-size:13px;line-height:1.5}
.sf-divider{height:1px;border:0;background:var(--sf-line);margin:2px 0}
.sf-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--sf-text2)}
.sf-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.sf-axis{fill:var(--sf-text3);font:11px var(--sf-font,system-ui,sans-serif)}
.sf-gridline{stroke:var(--sf-line);stroke-width:1}
.sf-c1{color:var(--sf-c1)}.sf-c2{color:var(--sf-c2)}.sf-c3{color:var(--sf-c3)}.sf-c4{color:var(--sf-c4)}.sf-c5{color:var(--sf-c5)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`.replace(/\n+/g, '\n');
}

/**
 * Belge içinde çalışan yardımcılar: kaydırıcı doluluğu (--p), tema bilgisi ve Chart.js varsayılanları.
 * `sf.theme.colors` grafik serileri için sıralı palettir (ilki vurgu rengi).
 */
export const WIDGET_KIT_JS = `
(function(){
var cs=getComputedStyle(document.documentElement);
function v(n){return cs.getPropertyValue(n).trim()}
function fill(r){var a=+r.min||0,b=r.max===''||r.max==null?100:+r.max;r.style.setProperty('--p',(b>a?(r.value-a)/(b-a)*100:0)+'%')}
function all(){document.querySelectorAll('input[type=range]').forEach(fill)}
document.addEventListener('input',function(e){if(e.target&&e.target.type==='range')fill(e.target)},true);
document.addEventListener('DOMContentLoaded',all);addEventListener('load',all);
var sf=window.sf=window.sf||{};
sf.theme={get colors(){return[v('--sf-c1'),v('--sf-c2'),v('--sf-c3'),v('--sf-c4'),v('--sf-c5')]},get text(){return v('--sf-text')},get muted(){return v('--sf-text3')},get line(){return v('--sf-line')},get surface(){return v('--sf-surface')},get accent(){return v('--sf-accent')},get font(){return v('--sf-font')}};
sf.fmt=function(n,o){try{return new Intl.NumberFormat(document.documentElement.lang||undefined,o).format(n)}catch(e){return String(n)}};
sf.chartDefaults=function(C){if(!C||!C.defaults)return;var d=C.defaults;d.color=v('--sf-text2');d.borderColor=v('--sf-line');d.font.family=v('--sf-font');d.font.size=12;d.responsive=true;d.maintainAspectRatio=false;d.animation=false;
if(d.plugins&&d.plugins.legend){d.plugins.legend.labels=Object.assign(d.plugins.legend.labels||{},{boxWidth:10,boxHeight:10,usePointStyle:true})}};
})();
`;
