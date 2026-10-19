import { describe, expect, it } from 'vitest';
import type { AiMessage } from '../src/services/ai.ts';
import { CodeQueue } from '../src/services/code-queue.ts';
import { messagesTokens, pruneToolResults } from '../src/services/code-context.ts';

const never = new AbortController().signal;

describe('CodeQueue', () => {
  it('sınır dolana kadar hemen başlatır, fazlasını sıraya koyar ve sıra numarasını bildirir', async () => {
    const q = new CodeQueue({ maxRuns: 2, maxQueue: 5 });
    const r1 = await q.acquire('a', never);
    const r2 = await q.acquire('b', never);
    const pos: number[] = [];
    const p3 = q.acquire('c', never, (n) => pos.push(n));
    const pos4: number[] = [];
    const p4 = q.acquire('d', never, (n) => pos4.push(n));
    expect(q.stats).toEqual({ running: 2, queued: 2, maxRuns: 2 });
    expect(pos).toEqual([1]);
    expect(pos4).toEqual([2]);
    r1();
    const r3 = await p3;
    expect(pos4).toEqual([2, 1]); // d öne kaydı
    expect(q.stats).toMatchObject({ running: 2, queued: 1 });
    r2();
    const r4 = await p4;
    r3();
    r4();
    expect(q.stats).toMatchObject({ running: 0, queued: 0 });
  });

  it('kullanıcı başına tek çalıştırma: aynı kullanıcının ikincisi bekler, başkası geçer', async () => {
    const q = new CodeQueue({ maxRuns: 3, maxQueue: 5 });
    const a1 = await q.acquire('a', never);
    let a2Started = false;
    const a2 = q.acquire('a', never).then((r) => ((a2Started = true), r));
    const b = await q.acquire('b', never); // a beklerken b geçer
    expect(a2Started).toBe(false);
    a1();
    const r = await a2;
    expect(a2Started).toBe(true);
    r();
    b();
  });

  it('kuyruk doluysa 503, iptal edilen bekleyen sıradan çıkar', async () => {
    const q = new CodeQueue({ maxRuns: 1, maxQueue: 1 });
    const r1 = await q.acquire('a', never);
    const ctl = new AbortController();
    const waiting = q.acquire('b', ctl.signal);
    await expect(q.acquire('c', never)).rejects.toMatchObject({ status: 503, code: 'upstream_busy' });
    ctl.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(q.stats.queued).toBe(0);
    r1();
    const r = await q.acquire('c', never);
    r();
  });

  it('bırakma fonksiyonu tekrar çağrılsa da sayaç bozulmaz', async () => {
    const q = new CodeQueue({ maxRuns: 1, maxQueue: 1 });
    const r = await q.acquire('a', never);
    r();
    r();
    expect(q.stats.running).toBe(0);
    const r2 = await q.acquire('a', never);
    expect(q.stats.running).toBe(1);
    r2();
  });
});

describe('bağlam budama', () => {
  const tool = (n: number, size: number): AiMessage => ({ role: 'tool', tool_call_id: `c${n}`, content: `çıktı ${n} ${'x'.repeat(size)}` });
  const convo = (): AiMessage[] => {
    const m: AiMessage[] = [{ role: 'system', content: 'sistem' }, { role: 'user', content: 'görev' }];
    for (let i = 0; i < 12; i++) m.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read', arguments: '{}' } }] }, tool(i, 6_000));
    return m;
  };

  it('son N sonucu korur, eskileri kırpar; sistem ve kullanıcı mesajlarına dokunmaz', () => {
    const out = pruneToolResults(convo(), { keepRecent: 4, trimTo: 300, budgetTokens: 1e9 });
    const tools = out.filter((m) => m.role === 'tool');
    expect(tools.slice(-4).every((m) => m.content.length > 5_000)).toBe(true);
    expect(tools.slice(0, 8).every((m) => m.content.length < 500 && m.content.includes('trimmed'))).toBe(true);
    expect(out[0]).toEqual({ role: 'system', content: 'sistem' });
    expect(out[1]).toEqual({ role: 'user', content: 'görev' });
    expect(out.filter((m) => m.role === 'assistant')).toHaveLength(12); // tool_calls korunur
  });

  it('bütçe aşılırsa korunan sayıyı küçültür; özgün diziyi değiştirmez', () => {
    const base = convo();
    const before = JSON.stringify(base);
    const out = pruneToolResults(base, { keepRecent: 8, trimTo: 200, budgetTokens: 6_000 });
    expect(JSON.stringify(base)).toBe(before);
    expect(messagesTokens(out)).toBeLessThan(messagesTokens(base));
    expect(out.filter((m) => m.role === 'tool' && m.content.length > 5_000).length).toBeLessThanOrEqual(4);
  });

  it('kısa sonuçlar kırpılmaz', () => {
    const m: AiMessage[] = [{ role: 'tool', tool_call_id: 'a', content: 'kısa' }, { role: 'tool', tool_call_id: 'b', content: 'x'.repeat(5_000) }, { role: 'tool', tool_call_id: 'c', content: 'son' }];
    const out = pruneToolResults(m, { keepRecent: 1, trimTo: 100, budgetTokens: 1e9 });
    expect(out[0]!.content).toBe('kısa');
    expect(out[1]!.content).toContain('trimmed');
    expect(out[2]!.content).toBe('son');
  });
});
