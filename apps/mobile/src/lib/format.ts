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

export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
