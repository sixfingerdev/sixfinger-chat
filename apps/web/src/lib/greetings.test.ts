import { describe, expect, it } from 'vitest';
import { GREETING_POOLS, pickGreeting, timeBucket } from '@sixfinger/shared';

describe('selamlamalar', () => {
  it('saat dilimlerini ayırır', () => {
    expect(timeBucket(7)).toBe('morning');
    expect(timeBucket(13)).toBe('afternoon');
    expect(timeBucket(19)).toBe('evening');
    expect(timeBucket(2)).toBe('night');
    expect(timeBucket(23)).toBe('night');
  });

  it('adlı kullanıcıda ismi yerleştirir, yer tutucu kalmaz', () => {
    for (const locale of ['tr', 'en'] as const) {
      for (let h = 0; h < 24; h++) {
        for (const r of [0, 0.3, 0.59, 0.61, 0.99]) {
          const g = pickGreeting({ locale, name: 'Enes', hour: h, rand: () => r });
          expect(g).toContain('Enes');
          expect(g).not.toContain('{name}');
        }
      }
    }
  });

  it('misafirde isim olmadan selamlar', () => {
    for (const locale of ['tr', 'en'] as const) {
      for (let h = 0; h < 24; h++) {
        const g = pickGreeting({ locale, hour: h, rand: () => 0.5 });
        expect(g).not.toContain('{name}');
        expect(g.length).toBeGreaterThan(0);
      }
    }
  });

  it('gece "night owl" çıkabilir', () => {
    const g = pickGreeting({ locale: 'en', name: 'Enes', hour: 1, rand: () => 0 });
    expect(g).toBe('Hello night owl Enes');
  });

  it('yeterince çok varyant var', () => {
    const count = (p: { named: string[]; anon: string[] }) => p.named.length + p.anon.length;
    const total = (['tr', 'en'] as const).reduce(
      (n, l) => n + count(GREETING_POOLS.GENERIC[l]) + Object.values(GREETING_POOLS.BY_TIME[l]).reduce((m, p) => m + count(p), 0),
      0,
    );
    expect(total).toBeGreaterThan(200);
  });
});
