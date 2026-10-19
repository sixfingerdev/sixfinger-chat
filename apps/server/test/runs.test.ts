import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sixfinger/shared';
import { createRunHub } from '../src/services/runs.ts';

describe('çalışma merkezi (RunHub)', () => {
  it('yanıt bitince (settle) sohbet yeni mesaja açılır; başlık gibi yan işler beklemez', () => {
    const hub = createRunHub();
    const run = hub.start('chat1', 'u1', 'a1');
    expect(hub.forChat('chat1')).toBe(run);
    expect(hub.countForUser('u1')).toBe(1);
    run.settle(); // `done` gönderildi, başlık üretiliyor
    expect(hub.forChat('chat1')).toBeUndefined();
    expect(hub.countForUser('u1')).toBe(0);
    expect(hub.activeIds('chat1')).toEqual([]);
    expect(hub.activeChatIds()).toEqual([]);
    // sıradaki mesaj hemen başlayabilir
    const next = hub.start('chat1', 'u1', 'a2');
    expect(hub.forChat('chat1')).toBe(next);
  });

  it('evre olaylarına sunucunun geçen süresi eklenir; geri bağlanan istemci anlık görüntüyle birlikte son evreyi alır', async () => {
    const hub = createRunHub();
    const run = hub.start('c', 'u', 'a');
    const got: StreamEvent[] = [];
    run.subscribe({ send: (e) => got.push(e), close: () => {} }, false);
    run.emit({ type: 'phase', phase: 'preparing' });
    await new Promise((r) => setTimeout(r, 30));
    run.emit({ type: 'phase', phase: 'working' });
    const phases = got.filter((e): e is Extract<StreamEvent, { type: 'phase' }> => e.type === 'phase');
    expect(phases.map((p) => p.phase)).toEqual(['preparing', 'working']);
    expect(phases[1]!.elapsedMs).toBeGreaterThanOrEqual(25);

    run.snapshot = () => ({ id: 'a', role: 'assistant', content: 'x', parts: [] }) as never;
    await new Promise((r) => setTimeout(r, 30));
    const late: StreamEvent[] = [];
    run.subscribe({ send: (e) => late.push(e), close: () => {} }, true);
    expect(late.map((e) => e.type)).toEqual(['snapshot', 'phase']);
    expect((late[1] as Extract<StreamEvent, { type: 'phase' }>).elapsedMs).toBeGreaterThanOrEqual(55);
  });
});
