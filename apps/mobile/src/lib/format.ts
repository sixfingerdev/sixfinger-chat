import type { ChatDTO } from '@sixfinger/shared';
import * as Clipboard from 'expo-clipboard';

export function chatDate(c: ChatDTO): Date {
  return new Date(c.lastMessageAt ?? c.createdAt);
}

export type GroupKey = 'pinned' | 'today' | 'yesterday' | 'week' | 'month' | 'older';

export function groupChats(chats: ChatDTO[], now = new Date()): Array<{ key: GroupKey; chats: ChatDTO[] }> {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const DAY = 86_400_000;
  const buckets: Record<GroupKey, ChatDTO[]> = { pinned: [], today: [], yesterday: [], week: [], month: [], older: [] };
  for (const c of chats) {
    if (c.pinned) {
      buckets.pinned.push(c);
      continue;
    }
    const t = startOfDay(chatDate(c));
    if (t >= today) buckets.today.push(c);
    else if (t >= today - DAY) buckets.yesterday.push(c);
    else if (t >= today - 7 * DAY) buckets.week.push(c);
    else if (t >= today - 30 * DAY) buckets.month.push(c);
    else buckets.older.push(c);
  }
  return (Object.keys(buckets) as GroupKey[]).filter((k) => buckets[k].length).map((key) => ({ key, chats: buckets[key] }));
}

export function formatDuration(ms: number, locale: 'tr' | 'en' = 'tr'): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (locale === 'en') return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toLocaleUpperCase();
}

export function timeUntil(iso: string, locale: 'tr' | 'en'): string {
  const ms = new Date(iso).getTime() - Date.now();
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  const m = Math.max(0, Math.floor((ms % 3_600_000) / 60_000));
  if (locale === 'tr') return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/** Kısa göreli zaman: "6 dk", "10 sa", "2 g" / "6m", "10h", "2d". */
export function ago(iso: string | null, locale: 'tr' | 'en', now = Date.now()): string {
  if (!iso) return '';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  const unit = locale === 'tr' ? { m: 'dk', h: 'sa', d: 'g' } : { m: 'm', h: 'h', d: 'd' };
  if (m < 1) return locale === 'tr' ? 'şimdi' : 'now';
  if (m < 60) return `${m} ${unit.m}`;
  if (m < 1_440) return `${Math.floor(m / 60)} ${unit.h}`;
  return `${Math.floor(m / 1_440)} ${unit.d}`;
}

/** Disk boyutu: 512 → "512 MB", 1536 → "1,5 GB" (TR) / "1.5 GB". */
export function formatMb(mb: number, locale: 'tr' | 'en' = 'tr'): string {
  if (mb < 1_024) return `${Math.round(mb)} MB`;
  const gb = Math.round((mb / 1_024) * 10) / 10;
  const text = Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
  return `${locale === 'tr' ? text.replace('.', ',') : text} GB`;
}

/** Token sayısı: 842 → "842", 12 345 → "12,3k". */
export function formatTokens(n: number, locale: 'tr' | 'en' = 'tr'): string {
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US');
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)}M`;
  if (n >= 1_000) return `${fmt(n / 1_000)}k`;
  return String(Math.round(n));
}
