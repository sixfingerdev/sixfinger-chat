import { describe, expect, it } from 'vitest';
import type { AiMessage } from '../src/services/ai.ts';
import type { HistoryItem } from '../src/services/prompt.ts';
import { applyCompaction, buildCodeHistory, SUMMARY_HEADER, splitForCompaction } from '../src/services/code-context.ts';

const call = (id: string): AiMessage => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'bash', arguments: '{}' } }] });
const res = (id: string, n: number): AiMessage => ({ role: 'tool', tool_call_id: id, content: 'x'.repeat(n) });
const sys: AiMessage = { role: 'system', content: 's' };

describe('splitForCompaction', () => {
  it('kuyruk yalnızca bu turdan, araç çağıran asistan mesajıyla başlar; çağrı/sonuç çifti bölünmez', () => {
    const m: AiMessage[] = [sys, { role: 'user', content: 'eski' }, { role: 'assistant', content: 'eski yanıt' }, { role: 'user', content: 'yeni' }, call('a'), res('a', 3_500), call('b'), res('b', 3_500), call('c'), res('c', 3_500)];
    const sp = splitForCompaction(m, 3, 1_500)!;
    expect(sp.tailStart).toBe(8); // yalnızca son çift bütçeye sığar
    expect(sp.tail.map((x) => x.role)).toEqual(['assistant', 'tool']);
    expect(sp.head).toHaveLength(7);
  });

  it('tur küçükse kuyruk turun kullanıcı mesajıyla başlar; özetlenecek bir şey yoksa null', () => {
    const m: AiMessage[] = [sys, { role: 'user', content: 'eski' }, { role: 'assistant', content: 'yanıt' }, { role: 'user', content: 'yeni' }];
    expect(splitForCompaction(m, 3, 10_000)).toMatchObject({ tailStart: 3 });
    expect(splitForCompaction([sys, { role: 'user', content: 'yalnız' }], 1, 10_000)).toBeNull();
  });
});

describe('applyCompaction + buildCodeHistory', () => {
  const parts = (keepFromId: string | null, keepUser: boolean): HistoryItem['parts'] => [
    { type: 'tool', id: 'old', name: 'bash', args: { command: 'eski' }, status: 'done', output: 'ESKI' },
    { type: 'tool', id: 'k1', name: 'bash', args: { command: 'korunan' }, status: 'done', output: 'KORUNAN' },
    { type: 'tool', id: 'compact-1', name: 'compaction', args: {}, status: 'done', output: `${SUMMARY_HEADER}\n\nÖZET`, meta: { keepFromId, keepUser } },
    { type: 'tool', id: 'n1', name: 'bash', args: { command: 'sonra' }, status: 'done', output: 'SONRA' },
    { type: 'text', text: 'bitti' },
  ];

  it('geçmiş: özet + korunan kuyruk + sonrası; öncesi (kuyruk dışı) geri gelmez', () => {
    const history: HistoryItem[] = [
      { role: 'user', content: 'ilk istek' },
      { role: 'assistant', content: 'bitti', parts: parts('k1', false) },
      { role: 'user', content: 'yeni istek' },
    ];
    const out = buildCodeHistory(history, 50_000);
    expect(out[0]).toMatchObject({ role: 'user' });
    expect(out[0]!.content).toContain('ÖZET');
    const text = JSON.stringify(out);
    expect(text).toContain('KORUNAN');
    expect(text).toContain('SONRA');
    expect(text).not.toContain('ESKI');
    expect(out.at(-1)).toMatchObject({ role: 'user', content: 'yeni istek' });
    // art arda iki kullanıcı mesajı yok
    expect(out.every((m, i) => !(i > 0 && m.role === 'user' && out[i - 1]!.role === 'user'))).toBe(true);
  });

  it('keepUser: turun kullanıcı mesajı özetle birleştirilir', () => {
    const history: HistoryItem[] = [
      { role: 'user', content: 'ilk istek' },
      { role: 'assistant', content: 'bitti', parts: parts('k1', true) },
      { role: 'user', content: 'yeni istek' },
    ];
    const out = buildCodeHistory(history, 50_000);
    expect(out[0]!.content).toContain('[Current request from the user]\nilk istek');
    expect(JSON.stringify(out)).not.toContain('ESKI');
  });

  it('özet yoksa düz sığdırma', () => {
    const out = buildCodeHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], 5_000);
    expect(out.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('applyCompaction: kuyruk kullanıcı mesajıyla başlıyorsa tek kullanıcı mesajında birleşir', () => {
    const m: AiMessage[] = [sys, { role: 'user', content: 'eski' }, { role: 'assistant', content: 'y' }, { role: 'user', content: 'yeni' }, call('a'), res('a', 5)];
    const split = splitForCompaction(m, 3, 10_000)!;
    const r = applyCompaction(m, split, 3, 'ÖZET', 'yeni');
    expect(r.messages.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(r.messages[1]!.content).toContain('yeni');
    expect(r).toMatchObject({ keepUser: true, keepFromId: 'a', turnStart: 1 });
  });
});
