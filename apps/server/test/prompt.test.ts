import { describe, expect, it } from 'vitest';
import { cleanTitle, fallbackTitle, fitHistory } from '../src/services/prompt.ts';

describe('prompt yardımcıları', () => {
  it('fitHistory son mesajı daima korur ve eskiyi keser', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `mesaj ${i} ` + 'x'.repeat(400),
    }));
    history.push({ role: 'user', content: 'son soru' });
    const out = fitHistory(history.slice(0, history.length - 1).concat(history.at(-1)!), 1_000);
    expect(out.at(-1)!.content).toBe('son soru');
    expect(out.length).toBeLessThan(history.length);
    expect(out[0]!.role).toBe('user');
  });

  it('çok uzun tek mesaj bütçeye kırpılır', () => {
    const out = fitHistory([{ role: 'user', content: 'a'.repeat(100_000) }], 500);
    expect(out).toHaveLength(1);
    expect(out[0]!.content.length).toBeLessThanOrEqual(500 * 3.5);
  });

  it('cleanTitle tırnak ve noktayı temizler, uzunluğu sınırlar', () => {
    expect(cleanTitle('"React Todo Uygulaması."', 'x')).toBe('React Todo Uygulaması');
    expect(cleanTitle('', 'yedek')).toBe('yedek');
    expect(cleanTitle('a'.repeat(100), 'x').length).toBeLessThanOrEqual(60);
  });

  it('fallbackTitle kısaltır', () => {
    expect(fallbackTitle('  merhaba   dünya ')).toBe('merhaba dünya');
    expect(fallbackTitle('x'.repeat(100)).length).toBeLessThanOrEqual(48);
  });
});
