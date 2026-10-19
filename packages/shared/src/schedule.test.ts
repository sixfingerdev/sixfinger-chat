import { describe, expect, it } from 'vitest';
import { computeNextRun, describeSchedule, scheduleSpecSchema } from './schedule.ts';

const TR = 'Europe/Istanbul'; // UTC+3, yaz saati yok

describe('computeNextRun', () => {
  it('günlük: bugünkü saat geçmediyse bugün, geçtiyse yarın (İstanbul)', () => {
    // 2026-10-19 06:00 UTC = 09:00 İstanbul
    const before = new Date('2026-10-19T05:30:00Z'); // 08:30 yerel
    expect(computeNextRun({ kind: 'daily', time: '09:00' }, TR, before)?.toISOString()).toBe('2026-10-19T06:00:00.000Z');
    const after = new Date('2026-10-19T06:00:00Z'); // tam 09:00: sonraki gün
    expect(computeNextRun({ kind: 'daily', time: '09:00' }, TR, after)?.toISOString()).toBe('2026-10-20T06:00:00.000Z');
  });

  it('haftalık: yalnızca seçili günler (1=Pzt … 7=Paz)', () => {
    // 2026-10-19 Pazartesi. Çarşamba(3) ve Cuma(5) 18:30
    const from = new Date('2026-10-19T12:00:00Z');
    const next = computeNextRun({ kind: 'weekly', days: [3, 5], time: '18:30' }, TR, from)!;
    expect(next.toISOString()).toBe('2026-10-21T15:30:00.000Z');
    const after = computeNextRun({ kind: 'weekly', days: [3, 5], time: '18:30' }, TR, next)!;
    expect(after.toISOString()).toBe('2026-10-23T15:30:00.000Z');
  });

  it('yaz saati geçişini doğru ele alır (New York)', () => {
    // 2026-03-08'de New York yaz saatine geçer (02:00 → 03:00). 09:00 yerel: önce UTC-5, sonra UTC-4.
    const a = computeNextRun({ kind: 'daily', time: '09:00' }, 'America/New_York', new Date('2026-03-07T20:00:00Z'))!;
    expect(a.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    const b = computeNextRun({ kind: 'daily', time: '09:00' }, 'America/New_York', new Date('2026-03-06T20:00:00Z'))!;
    expect(b.toISOString()).toBe('2026-03-07T14:00:00.000Z');
  });

  it('tek seferlik: geçmişse null; aralık: from + dakika', () => {
    const from = new Date('2026-10-19T10:00:00Z');
    expect(computeNextRun({ kind: 'once', at: '2026-10-19T09:00:00Z' }, TR, from)).toBeNull();
    expect(computeNextRun({ kind: 'once', at: '2026-10-19T11:00:00Z' }, TR, from)?.toISOString()).toBe('2026-10-19T11:00:00.000Z');
    expect(computeNextRun({ kind: 'interval', minutes: 90 }, TR, from)?.toISOString()).toBe('2026-10-19T11:30:00.000Z');
  });
});

describe('scheduleSpecSchema / describeSchedule', () => {
  it('geçersiz zamanları reddeder', () => {
    expect(scheduleSpecSchema.safeParse({ kind: 'daily', time: '25:00' }).success).toBe(false);
    expect(scheduleSpecSchema.safeParse({ kind: 'interval', minutes: 5 }).success).toBe(false);
    expect(scheduleSpecSchema.safeParse({ kind: 'weekly', days: [], time: '09:00' }).success).toBe(false);
    expect(scheduleSpecSchema.safeParse({ kind: 'weekly', days: [8], time: '09:00' }).success).toBe(false);
  });
  it('okunur açıklama üretir', () => {
    expect(describeSchedule({ kind: 'daily', time: '09:00' }, 'tr')).toBe('Her gün 09:00');
    expect(describeSchedule({ kind: 'weekly', days: [5, 1], time: '18:30' }, 'tr')).toBe('Pzt, Cum 18:30');
    expect(describeSchedule({ kind: 'interval', minutes: 120 }, 'tr')).toBe('Her 2 saatte bir');
    expect(describeSchedule({ kind: 'interval', minutes: 45 }, 'en')).toBe('Every 45 min');
  });
});
