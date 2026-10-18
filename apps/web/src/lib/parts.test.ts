import { describe, expect, it } from 'vitest';
import { messageParts } from '@sixfinger/shared';

const base = { parts: [], content: '', reasoning: '', reasoningMs: null };

describe('messageParts', () => {
  it('eski mesajda (parça yok) düşünce + metni aynı sırada üretir', () => {
    expect(messageParts({ ...base, content: 'cevap', reasoning: 'düşünce', reasoningMs: 1200 })).toEqual([
      { type: 'reasoning', text: 'düşünce', ms: 1200 },
      { type: 'text', text: 'cevap' },
    ]);
  });

  it('parçalarda düşünce varsa olduğu gibi döner (araç sonrası yeni düşünce ayrı blok)', () => {
    const parts = [
      { type: 'reasoning', text: 'a', ms: 100 },
      { type: 'tool', id: 't', name: 'web_search', args: {}, status: 'done' },
      { type: 'reasoning', text: 'b', ms: 200 },
      { type: 'text', text: 'son' },
    ] as const;
    expect(messageParts({ ...base, content: 'son', reasoning: 'ab', parts: [...parts] })).toEqual([...parts]);
  });

  it('düşünce parçası olmayan ama reasoning alanı dolu eski araçlı mesaja başa düşünce ekler', () => {
    const out = messageParts({ ...base, reasoning: 'x', parts: [{ type: 'text', text: 'm' }] });
    expect(out.map((p) => p.type)).toEqual(['reasoning', 'text']);
  });

  it('boş mesajda boş liste', () => {
    expect(messageParts(base)).toEqual([]);
  });
});
