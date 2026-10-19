/**
 * Zamanlanmış görevler: belirli zamanlarda bir istemi (prompt) otomatik çalıştırıp sonucu yeni bir sohbet olarak bırakır.
 * Çalışma zamanı hesabı (bir sonraki çalışma) hem sunucuda hem istemci önizlemesinde aynı koddan gelir.
 */

import { z } from 'zod';
import type { ChatMode } from './models.ts';

export const SCHEDULE_LIMITS = {
  tasks: 20,
  /** Tekrarlayan görevlerde en kısa aralık (dakika): kota ve maliyeti korur. */
  minIntervalMinutes: 30,
  titleMax: 80,
  promptMax: 4_000,
} as const;

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const scheduleSpecSchema = z.discriminatedUnion('kind', [
  /** Tek seferlik: ISO tarih-saat (UTC ya da ofsetli). */
  z.object({ kind: z.literal('once'), at: z.string().datetime({ offset: true }) }),
  /** Her N dakikada bir. */
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(SCHEDULE_LIMITS.minIntervalMinutes).max(60 * 24 * 30) }),
  /** Her gün, `timezone` saatiyle HH:MM. */
  z.object({ kind: z.literal('daily'), time: z.string().regex(TIME_RE) }),
  /** Haftanın seçili günleri (1 = Pazartesi … 7 = Pazar), HH:MM. */
  z.object({ kind: z.literal('weekly'), days: z.array(z.number().int().min(1).max(7)).min(1).max(7), time: z.string().regex(TIME_RE) }),
]);
export type ScheduleSpec = z.infer<typeof scheduleSpecSchema>;

export const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const timezoneSchema = z.string().min(1).max(64).refine(isValidTimezone, 'Geçersiz saat dilimi');
const modeEnum = z.enum(['fast', 'balanced', 'deep']);

export const createScheduledTaskSchema = z.object({
  title: z.string().trim().min(1).max(SCHEDULE_LIMITS.titleMax),
  prompt: z.string().trim().min(1).max(SCHEDULE_LIMITS.promptMax),
  mode: modeEnum.default('balanced'),
  schedule: scheduleSpecSchema,
  timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
  enabled: z.boolean().default(true),
});
export const updateScheduledTaskSchema = z.object({
  title: z.string().trim().min(1).max(SCHEDULE_LIMITS.titleMax).optional(),
  prompt: z.string().trim().min(1).max(SCHEDULE_LIMITS.promptMax).optional(),
  mode: modeEnum.optional(),
  schedule: scheduleSpecSchema.optional(),
  timezone: timezoneSchema.optional(),
  enabled: z.boolean().optional(),
});
export type CreateScheduledTaskInput = z.infer<typeof createScheduledTaskSchema>;
/** İstemcinin gönderdiği gövde (varsayılanlı alanlar isteğe bağlı). */
export type CreateScheduledTaskBody = z.input<typeof createScheduledTaskSchema>;
export type UpdateScheduledTaskInput = z.infer<typeof updateScheduledTaskSchema>;

export interface ScheduledTaskDTO {
  id: string;
  title: string;
  prompt: string;
  mode: ChatMode;
  schedule: ScheduleSpec;
  timezone: string;
  enabled: boolean;
  /** Bir sonraki çalışma; devre dışıysa ya da bitmişse null. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** Son çalışmanın sohbeti. */
  lastChatId: string | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  lastError: string | null;
  runCount: number;
  /** Görevi kim oluşturdu. */
  source: 'user' | 'agent';
  createdAt: string;
}

export interface ScheduledRunDTO {
  chatId: string;
  title: string;
  at: string;
}

/** Artifacts sayfasındaki bir kayıt: bir sohbette üretilmiş artifact'ın en yeni sürümü. */
export interface ArtifactListItemDTO {
  chatId: string;
  chatTitle: string;
  messageId: string;
  /** Sohbet içindeki artifact kimliği (`<artifact id="…">`). */
  artifactId: string;
  title: string;
  kind: 'html' | 'svg' | 'markdown' | 'mermaid';
  versions: number;
  updatedAt: string;
}

// ---------- Saat dilimi hesabı (kütüphanesiz) ----------

interface ZonedParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

function partsOf(ms: number, tz: string): ZonedParts {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year!, m: o.month!, d: o.day!, hh: o.hour!, mm: o.minute!, ss: o.second! };
}

/** Saat diliminin o andaki UTC'ye göre farkı (ms). */
function offsetMs(ms: number, tz: string): number {
  const p = partsOf(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/** Yerel (tz) takvim zamanını UTC ms'ye çevirir; yaz saati geçişlerinde ofseti yeniden doğrular. */
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(first, tz);
  return second;
}

/** `from`'dan SONRAKİ ilk çalışma zamanı; yoksa (geçmiş tek seferlik) null. */
export function computeNextRun(spec: ScheduleSpec, timezone: string, from: Date): Date | null {
  if (spec.kind === 'once') {
    const at = new Date(spec.at);
    return at.getTime() > from.getTime() ? at : null;
  }
  if (spec.kind === 'interval') return new Date(from.getTime() + spec.minutes * 60_000);
  const [hh, mm] = spec.time.split(':').map(Number) as [number, number];
  const today = partsOf(from.getTime(), timezone);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const iso = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (spec.kind === 'weekly' && !spec.days.includes(iso)) continue;
    const t = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, timezone);
    if (t > from.getTime()) return new Date(t);
  }
  return null;
}

const DAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Her gün 09:00", "Pzt, Çar 18:30", "Her 2 saatte bir" gibi kısa açıklama. */
export function describeSchedule(spec: ScheduleSpec, locale: 'tr' | 'en', timezone?: string): string {
  const tr = locale === 'tr';
  switch (spec.kind) {
    case 'once': {
      const f = new Intl.DateTimeFormat(tr ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
      return tr ? `Bir kez · ${f.format(new Date(spec.at))}` : `Once · ${f.format(new Date(spec.at))}`;
    }
    case 'interval': {
      const m = spec.minutes;
      const h = m % 60 === 0 ? m / 60 : null;
      if (h !== null && h % 24 === 0) return tr ? `Her ${h / 24} günde bir` : `Every ${h / 24} day(s)`;
      return h !== null ? (tr ? `Her ${h} saatte bir` : `Every ${h} hour(s)`) : tr ? `Her ${m} dakikada bir` : `Every ${m} min`;
    }
    case 'daily':
      return tr ? `Her gün ${spec.time}` : `Daily at ${spec.time}`;
    case 'weekly': {
      const names = [...spec.days].sort().map((d) => (tr ? DAYS_TR : DAYS_EN)[d - 1]);
      return `${names.join(', ')} ${spec.time}`;
    }
  }
}
