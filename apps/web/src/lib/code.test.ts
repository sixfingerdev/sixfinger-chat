import { describe, expect, it } from 'vitest';
import { CODE_MASCOT } from '@sixfinger/shared';
import { timeAgo } from './format.ts';

describe('timeAgo', () => {
  const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  it('kısa göreli zaman üretir', () => {
    expect(timeAgo(ago(5), 'tr')).toBe('şimdi');
    expect(timeAgo(ago(5), 'en')).toBe('now');
    expect(timeAgo(ago(6 * 60), 'tr')).toBe('6 dk');
    expect(timeAgo(ago(3 * 3600), 'en')).toBe('3h');
    expect(timeAgo(ago(2 * 86_400), 'tr')).toBe('2 g');
  });
});

describe('maskot ızgarası', () => {
  it('tüm satırlar aynı genişlikte, yalnızca # ve .', () => {
    expect(CODE_MASCOT.grid).toHaveLength(CODE_MASCOT.height);
    for (const row of CODE_MASCOT.grid) {
      expect(row).toHaveLength(CODE_MASCOT.width);
      expect(row).toMatch(/^[#.]+$/);
    }
  });
  it('altı parmak: en üstteki parmak satırında altı ayrı dikey çıkıntı sayılır', () => {
    // Parmakların bittiği satırda (palm üstü) ardışık # öbeklerinin sayısı altı olmalı.
    const fingerRow = CODE_MASCOT.grid.find((r) => r.startsWith('##.##.##'))!;
    expect(fingerRow.match(/#+/g)).toHaveLength(6);
  });
});
