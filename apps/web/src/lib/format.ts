import type { ChatDTO } from '@sixfinger/shared';

export function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

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

export function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
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

/** "3 dk önce" / "3m ago" gibi kısa göreli zaman. */
export function timeAgo(iso: string, locale: 'tr' | 'en'): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const units: Array<[number, string, string]> = [
    [60, 'sn', 's'],
    [3600, 'dk', 'm'],
    [86_400, 'sa', 'h'],
    [604_800, 'g', 'd'],
  ];
  if (sec < 45) return locale === 'tr' ? 'şimdi' : 'now';
  let div = 1;
  for (const [limit, tr, en] of units) {
    if (sec < limit) return `${Math.max(1, Math.round(sec / div))}${locale === 'tr' ? ' ' + tr : en}`;
    div = limit;
  }
  return new Date(iso).toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export const slugify = (s: string): string =>
  s
    .toLocaleLowerCase('tr')
    .replace(/[ğ]/g, 'g')
    .replace(/[ü]/g, 'u')
    .replace(/[ş]/g, 's')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'sohbet';
