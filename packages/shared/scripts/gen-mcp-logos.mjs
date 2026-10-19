// Bağlayıcıların RESMÎ logolarını indirip `src/mcp-logos.ts` üretir: `node packages/shared/scripts/gen-mcp-logos.mjs` (ağ gerekir).
// Kaynaklar: svgl.app (marka kitlerinden derlenmiş resmî SVG'ler), iconify (logos, selfhst, thesvg-color) ve markanın kendi simgesi
// (Gamma, Wispr Flow: `assets/*.png`, sitelerinin simgesi). Logolar ilgili şirketlerin tescilli markalarıdır; yalnızca bağlayıcıyı
// tanıtmak için kullanılır.
import { readFileSync, writeFileSync } from 'node:fs';

const svgl = (f) => `https://svgl.app/library/${f}`;
const iconify = (prefix, name) => `https://api.iconify.design/${prefix}/${name}.svg`;
/** id → [açık tema, koyu tema (yoksa aynısı)] */
const SOURCES = {
  'google-drive': [svgl('drive.svg')], gmail: [svgl('gmail.svg')], 'google-calendar': [svgl('google-calendar.svg')],
  canva: [svgl('canva.svg')], notion: [svgl('notion.svg')], figma: [svgl('figma.svg')], slack: [svgl('slack.svg')],
  hubspot: [iconify('simple-icons', 'hubspot') + '?color=%23FF7A59'], asana: [svgl('asana-logo.svg')], linear: [svgl('linear.svg')],
  'google-sheets': [svgl('google-sheets.svg')], monday: [iconify('logos', 'monday-icon')], 'google-docs': [iconify('selfhst', 'google-docs')],
  intercom: [iconify('logos', 'intercom-icon')], box: [iconify('logos', 'box')], 'google-slides': [svgl('google-slides.svg')],
  adobe: [svgl('adobe.svg')], miro: [iconify('logos', 'miro-icon')], supabase: [svgl('supabase.svg')], shopify: [svgl('shopify.svg')],
  indeed: [iconify('thesvg-color', 'indeed')], vercel: [svgl('vercel.svg'), svgl('vercel_dark.svg')], spotify: [svgl('spotify.svg')],
  granola: [svgl('granola-light.svg'), svgl('granola-dark.svg')], 'microsoft-365': [iconify('selfhst', 'microsoft-365')],
};
const PNGS = { gamma: 'assets/gamma.png', 'wispr-flow': 'assets/wispr-flow.png' };

const get = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  const t = (await r.text()).replace(/<\?xml[^>]*>/, '').trim();
  if (!t.startsWith('<svg')) throw new Error(`${u}: SVG değil`);
  return t;
};
const out = {};
for (const [id, urls] of Object.entries(SOURCES)) {
  const [light, dark] = await Promise.all(urls.map(get));
  out[id] = dark ? { svg: light, dark } : { svg: light };
}
for (const [id, f] of Object.entries(PNGS)) out[id] = { png: `data:image/png;base64,${readFileSync(new URL(f, import.meta.url)).toString('base64')}` };

writeFileSync(
  new URL('../src/mcp-logos.ts', import.meta.url),
  `/** Bağlayıcıların resmî logoları. Üretici: packages/shared/scripts/gen-mcp-logos.mjs — elle düzenleme. */
export type McpLogo = { svg: string; dark?: string } | { png: string };

export const MCP_LOGOS: Record<string, McpLogo> = ${JSON.stringify(out, null, 1)};

export const mcpLogo = (presetId: string | null | undefined): McpLogo | undefined => (presetId ? MCP_LOGOS[presetId] : undefined);

/** \`<img src>\` için veri adresi (koyu temada \`dark\` varyantı varsa o). */
export const mcpLogoSrc = (logo: McpLogo, dark: boolean): string =>
  'png' in logo ? logo.png : \`data:image/svg+xml;utf8,\${encodeURIComponent(dark && logo.dark ? logo.dark : logo.svg)}\`;
`,
);
console.log(Object.keys(out).length, 'logo');
