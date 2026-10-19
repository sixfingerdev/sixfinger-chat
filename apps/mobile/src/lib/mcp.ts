import { fillPresetUrl, type McpPresetView, type McpScope, type McpServerDTO } from '@sixfinger/shared';
import type { Locale } from './i18n/index.ts';

/** `api.mcpUpdate` gövdesi. */
export interface McpPatch {
  label?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  scopes?: McpScope[];
  autoApprove?: boolean;
  allowTools?: string[];
}

export type ServerStatus = { kind: 'ok'; tools: number } | { kind: 'needsAuth' } | { kind: 'error'; message: string } | { kind: 'off' };

/** Satırdaki durum çipi: kapalı > yetki gerekiyor > hata > tamam. */
export function serverStatus(s: McpServerDTO): ServerStatus {
  if (!s.enabled) return { kind: 'off' };
  if (s.lastError === 'authorization_required') return { kind: 'needsAuth' };
  if (s.lastError) return { kind: 'error', message: s.lastError };
  if (s.authKind === 'oauth' && !s.connected) return { kind: 'needsAuth' };
  return { kind: 'ok', tools: s.tools.length };
}

/** OAuth ile yetkilendirme gerekiyor mu (katalog kartı eklenmiş ama bağlanmamış ya da özel sunucu 401 döndü)? */
export const needsOauth = (s: McpServerDTO): boolean => s.lastError === 'authorization_required' || (s.authKind === 'oauth' && !s.connected);

/** Katalog kartının "Bağlan" sheet'inde toplanan girdiler. */
export interface ConnectInput {
  values?: Record<string, string>;
  token?: string;
}

/** Bağlanmadan önce soru sorulması gereken kart mı (adres değişkeni ya da anahtarla bağlanma seçeneği)? */
export const presetAsks = (p: McpPresetView): boolean => Boolean(p.variables?.length || p.token);

/** Katalog kartından `api.mcpCreate` gövdesi; adres üretilemiyorsa (eksik değişken) null. */
export function presetRequest(p: McpPresetView, input: ConnectInput = {}): { label: string; url: string; preset: string; headers?: Record<string, string> } | null {
  const first = p.variables?.[0];
  const url = first ? fillPresetUrl(p, input.values ?? {}) : p.url;
  if (!url) return null;
  const token = input.token?.trim();
  const headers = p.token && token ? { [p.token.header]: (p.token.prefix ?? '') + token } : undefined;
  const label = first ? `${p.label} (${(input.values?.[first.key] ?? '').trim().toLowerCase()})` : p.label;
  return { label, url, preset: p.id, ...(headers ? { headers } : {}) };
}

export interface HeaderRow {
  name: string;
  value: string;
}

/** Form satırlarından başlık nesnesi: boş satırlar atılır; hiç yoksa undefined (başlıklar değişmesin / gönderilmesin). */
export function headerPayload(rows: HeaderRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const name = r.name.trim();
    const value = r.value.trim();
    if (name && value) out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export const isHttpsUrl = (v: string): boolean => /^https:\/\/[^\s/]+\.[^\s/]+/i.test(v.trim());

/** Sunucu DTO'suna yerel (iyimser) güncelleme: anahtarlar anında dönsün; gerçek yanıt gelince yerini alır. */
export function applyServerPatch(s: McpServerDTO, p: McpPatch): McpServerDTO {
  const next: McpServerDTO = { ...s };
  if (p.label !== undefined) next.label = p.label;
  if (p.enabled !== undefined) next.enabled = p.enabled;
  if (p.scopes !== undefined) next.scopes = p.scopes;
  if (p.autoApprove !== undefined) next.autoApprove = p.autoApprove;
  if (p.allowTools !== undefined) next.allowTools = p.allowTools;
  if (p.autoApprove !== undefined || p.allowTools !== undefined) {
    next.tools = s.tools.map((t) => ({ ...t, allowed: next.autoApprove || next.allowTools.includes(t.name) }));
  }
  return next;
}

/** Kartta gösterilecek kısaltılmış, girintili JSON. */
export function shortJson(value: unknown, max = 1_500): string {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2) ?? '';
  } catch {
    s = String(value);
  }
  return s.length > max ? `${s.slice(0, max)}\n…` : s;
}

/** `{tr, en}` metninden geçerli dile uygun olanı seçer. */
export const pickLocale = (v: { tr: string; en: string }, locale: Locale): string => v[locale] ?? v.tr;
