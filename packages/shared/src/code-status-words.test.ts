import { describe, expect, it } from 'vitest';
import { STATUS_WORDS, pickStatusWord } from './code-status-words.ts';

describe('pickStatusWord', () => {
  it('önceki kelimeyi tekrarlamaz ve listeden seçer', () => {
    for (const locale of ['tr', 'en'] as const) {
      let prev: string | undefined;
      for (let i = 0; i < 200; i++) {
        const w = pickStatusWord(locale, prev);
        expect(STATUS_WORDS[locale] as readonly string[]).toContain(w);
        expect(w).not.toBe(prev);
        prev = w;
      }
    }
  });
  it('rand sınır değerlerinde (0 ve ~1) geçerli kelime verir; listede tekrar yok', () => {
    expect(pickStatusWord('en', undefined, () => 0)).toBe(STATUS_WORDS.en[0]);
    expect(pickStatusWord('en', undefined, () => 0.9999999)).toBe(STATUS_WORDS.en.at(-1));
    for (const l of ['tr', 'en'] as const) expect(new Set(STATUS_WORDS[l]).size).toBe(STATUS_WORDS[l].length);
  });
});
