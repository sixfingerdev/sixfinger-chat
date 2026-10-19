// Bağlayıcı logolarını üretir: `npm i --no-save simple-icons` sonrası `node packages/shared/scripts/gen-mcp-logos.mjs`.
// simple-icons CC0'dır. Kütüphanede olmayan markalar (Canva, Slack, monday.com, Adobe, Gamma, Granola, Wispr Flow) harf işaretiyle gelir.
import * as si from 'simple-icons';
import { writeFileSync } from 'node:fs';

const ICONS = {
  'google-drive': 'siGoogledrive', gmail: 'siGmail', 'google-calendar': 'siGooglecalendar', notion: 'siNotion', figma: 'siFigma',
  hubspot: 'siHubspot', asana: 'siAsana', linear: 'siLinear', 'google-sheets': 'siGooglesheets', 'google-docs': 'siGoogledocs',
  intercom: 'siIntercom', box: 'siBox', 'google-slides': 'siGoogleslides', miro: 'siMiro', supabase: 'siSupabase', shopify: 'siShopify',
  indeed: 'siIndeed', vercel: 'siVercel', spotify: 'siSpotify',
};
const LETTERS = { canva: ['C', '00C4CC'], slack: ['S', 'E01E5A'], monday: ['m', 'FF3D57'], adobe: ['A', 'FA0F00'], gamma: ['G', '7C5CFF'], granola: ['G', '5FA55A'], 'wispr-flow': ['W', '6C5CE7'] };
// Neredeyse siyah / çok koyu renkler koyu temada görünmez: temanın metin rengini kullanır.
const dark = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70;
};
const out = {};
for (const [id, key] of Object.entries(ICONS)) {
  const icon = si[key];
  if (!icon) throw new Error(`simple-icons: ${key} yok`);
  out[id] = { shapes: [{ d: icon.path, fill: dark(icon.hex) ? 'currentColor' : `#${icon.hex}` }] };
}
for (const [id, [letter, hex]] of Object.entries(LETTERS)) out[id] = { letter, fill: `#${hex}` };
out['microsoft-365'] = {
  shapes: [
    { d: 'M2 2h9.5v9.5H2z', fill: '#F25022' },
    { d: 'M12.5 2H22v9.5h-9.5z', fill: '#7FBA00' },
    { d: 'M2 12.5h9.5V22H2z', fill: '#00A4EF' },
    { d: 'M12.5 12.5H22V22h-9.5z', fill: '#FFB900' },
  ],
};
const body = JSON.stringify(out, null, 1).replace(/"(\w+)":/g, '$1:').replace(/"/g, "'");
writeFileSync(
  new URL('../src/mcp-logos.ts', import.meta.url),
  `/** Bağlayıcı logoları (24x24 görünüm kutusu). Üretici: packages/shared/scripts/gen-mcp-logos.mjs — elle düzenleme. */
export type McpLogo = { shapes: Array<{ d: string; fill: string }> } | { letter: string; fill: string };

export const MCP_LOGOS: Record<string, McpLogo> = ${body};

export const mcpLogo = (presetId: string | null | undefined): McpLogo | undefined => (presetId ? MCP_LOGOS[presetId] : undefined);
`,
);
console.log(Object.keys(out).length, 'logo');
