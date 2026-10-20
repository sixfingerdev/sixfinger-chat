import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiChunk } from '../src/services/ai.ts';
import { auth, member, newChat, resetDb, setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb(env.ctx);
  env.ai.calls.length = 0;
  env.ai.failWith = null;
  env.ai.steps = [];
  env.ai.script = [{ type: 'content', text: 'Günaydın!' }];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = (id: string, name: string, args: object): AiChunk => ({ type: 'tool_calls', calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const task = { title: 'Sabah özeti', prompt: 'Bana güne başlarken kısa bir özet yaz.', schedule: { kind: 'daily', time: '09:00' } };

describe('zamanlanmış görev API', () => {
  it('oluştur / listele / güncelle / sil; sıradaki zaman hesaplanır', async () => {
    const a = await member(env);
    const c = await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: { ...task, mode: 'deep' } });
    expect(c.statusCode).toBe(201);
    const t = c.json().task;
    expect(t).toMatchObject({ title: 'Sabah özeti', mode: 'deep', enabled: true, source: 'user', timezone: 'Europe/Istanbul' });
    expect(new Date(t.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    const list = await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) });
    expect(list.json().tasks).toHaveLength(1);

    const off = await env.app.inject({ method: 'PATCH', url: `/api/schedule/${t.id}`, headers: auth(a), payload: { enabled: false } });
    expect(off.json().task).toMatchObject({ enabled: false, nextRunAt: null });
    const on = await env.app.inject({ method: 'PATCH', url: `/api/schedule/${t.id}`, headers: auth(a), payload: { enabled: true, schedule: { kind: 'interval', minutes: 60 } } });
    expect(on.json().task.nextRunAt).toBeTruthy();

    expect((await env.app.inject({ method: 'DELETE', url: `/api/schedule/${t.id}`, headers: auth(a) })).statusCode).toBe(204);
    expect((await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) })).json().tasks).toHaveLength(0);
  });

  it('geçersiz zaman, geçmiş tek seferlik ve misafir reddedilir; başkasının görevi 404', async () => {
    const a = await member(env);
    const b = await member(env);
    const bad = await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: { ...task, schedule: { kind: 'daily', time: '99:00' } } });
    expect(bad.statusCode).toBe(400);
    const past = await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: { ...task, schedule: { kind: 'once', at: '2020-01-01T00:00:00Z' } } });
    expect(past.statusCode).toBe(409);
    const own = (await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: task })).json().task;
    expect((await env.app.inject({ method: 'DELETE', url: `/api/schedule/${own.id}`, headers: auth(b) })).statusCode).toBe(404);
    const g = (await env.app.inject({ method: 'POST', url: '/api/auth/guest' })).json();
    expect((await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(g) })).statusCode).toBe(403);
  });
});

describe('çalıştırma', () => {
  it('zamanı gelen görev yeni bir sohbet açar, yanıtı üretir ve kaydeder', async () => {
    const a = await member(env);
    const t = (await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: task })).json().task;
    await env.ctx.db.query(`update scheduled_tasks set next_run_at = now() - interval '1 minute' where id = $1`, [t.id]);

    const due = await env.ctx.schedule.claimDue(5);
    expect(due).toHaveLength(1);
    // Alındıktan sonra sıradaki zaman ileriye taşınır; aynı görev ikinci kez alınmaz.
    expect(await env.ctx.schedule.claimDue(5)).toHaveLength(0);
    await env.ctx.runScheduled!(due[0]!);

    const after = (await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) })).json().tasks[0];
    expect(after).toMatchObject({ lastStatus: 'ok', runCount: 1 });
    expect(after.lastChatId).toBeTruthy();
    expect(new Date(after.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    const chat = (await env.app.inject({ method: 'GET', url: `/api/chats/${after.lastChatId}`, headers: auth(a) })).json();
    expect(chat.chat).toMatchObject({ title: 'Sabah özeti', taskId: t.id });
    expect(chat.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['user', task.prompt],
      ['assistant', 'Günaydın!'],
    ]);
    // Görev çalıştırmasında zamanlama araçları verilmez (zincirleme zamanlama yok) ve kullanıcıya soru sorulmaz notu vardır.
    const req = env.ai.calls.find((c) => c.messages.some((m) => m.role === 'user' && m.content === task.prompt))!;
    expect(JSON.stringify(req.tools ?? [])).not.toContain('schedule_create');
    expect(JSON.stringify(req.messages[0])).toContain('zamanlanmış bir görev');

    const runs = (await env.app.inject({ method: 'GET', url: `/api/schedule/${t.id}/runs`, headers: auth(a) })).json().runs;
    expect(runs).toHaveLength(1);
  });

  it('tek seferlik görev çalışınca kapanır; çok geç kalmışsa atlanır', async () => {
    const a = await member(env);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const t = (await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: { ...task, schedule: { kind: 'once', at } } })).json().task;
    await env.ctx.db.query(`update scheduled_tasks set next_run_at = now() - interval '1 minute' where id = $1`, [t.id]);
    const due = await env.ctx.schedule.claimDue(5);
    expect(due).toHaveLength(1);
    const row = (await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) })).json().tasks[0];
    expect(row).toMatchObject({ enabled: false, nextRunAt: null });

    const late = (await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: { ...task, schedule: { kind: 'once', at } } })).json().task;
    await env.ctx.db.query(`update scheduled_tasks set next_run_at = now() - interval '2 days' where id = $1`, [late.id]);
    expect(await env.ctx.schedule.claimDue(5)).toHaveLength(0);
    const skipped = (await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) })).json().tasks.find((x: { id: string }) => x.id === late.id);
    expect(skipped.lastStatus).toBe('skipped');
  });

  it('"Şimdi çalıştır" zamanlamayı bozmadan sohbet üretir', async () => {
    const a = await member(env);
    const t = (await env.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(a), payload: task })).json().task;
    const r = await env.app.inject({ method: 'POST', url: `/api/schedule/${t.id}/run`, headers: auth(a) });
    expect(r.statusCode).toBe(202);
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      const cur = (await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) })).json().tasks[0];
      if (cur.lastStatus === 'ok') {
        expect(cur.nextRunAt).toBe(t.nextRunAt);
        return;
      }
    }
    throw new Error('görev tamamlanmadı');
  });
});

describe('ajan araçları', () => {
  it('model schedule_create çağırınca görev oluşur ve sonuç kullanıcıya anlatılır', async () => {
    const a = await member(env);
    const chat = await newChat(env.app, a);
    env.ai.steps = [
      [call('t1', 'schedule_create', { title: 'Haber özeti', prompt: 'Bugünün teknoloji haberlerini özetle.', schedule: { kind: 'daily', time: '08:30' }, mode: 'fast' })],
      [{ type: 'content', text: 'Her sabah 08:30\'a kurdum.' }],
    ];
    const r = await env.app.inject({ method: 'POST', url: `/api/chats/${chat.id}/messages`, headers: auth(a), payload: { content: 'Her sabah 8:30da haber özeti gönder' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('tool_end');
    const tasks = (await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) })).json().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Haber özeti', source: 'agent', mode: 'fast', schedule: { kind: 'daily', time: '08:30' } });
    // Model araçları ve bilgilendirmeyi görür.
    const first = env.ai.calls[0]!;
    expect(JSON.stringify(first.tools)).toContain('schedule_create');
    expect(JSON.stringify(first.messages[0])).toContain('Zamanlanmış görevler');
  });

  it('geçersiz zaman modele hata olarak döner, görev oluşmaz', async () => {
    const a = await member(env);
    const chat = await newChat(env.app, a);
    env.ai.steps = [[call('t1', 'schedule_create', { title: 'x', prompt: 'y', schedule: { kind: 'daily', time: 'sabah' } })], [{ type: 'content', text: 'Tamam.' }]];
    await env.app.inject({ method: 'POST', url: `/api/chats/${chat.id}/messages`, headers: auth(a), payload: { content: 'kur' } });
    expect((await env.app.inject({ method: 'GET', url: '/api/schedule', headers: auth(a) })).json().tasks).toHaveLength(0);
  });
});

describe('Artifacts listesi', () => {
  it('sohbetlerdeki artifact\'ları en yeni sürümle ve sürüm sayısıyla listeler', async () => {
    const a = await member(env);
    const b = await member(env);
    const chat = await newChat(env.app, a, { title: 'Oyun sohbeti' });
    const art = (v: string) => `Hazır.\n<artifact id="yilan" type="html" title="Yılan Oyunu">\n<h1>${v}</h1>\n</artifact>`;
    for (const v of ['v1', 'v2']) {
      env.ai.script = [{ type: 'content', text: art(v) }];
      await env.app.inject({ method: 'POST', url: `/api/chats/${chat.id}/messages`, headers: auth(a), payload: { content: `yap ${v}` } });
    }
    env.ai.script = [{ type: 'content', text: 'Sade bir cevap.' }];
    await env.app.inject({ method: 'POST', url: `/api/chats/${chat.id}/messages`, headers: auth(a), payload: { content: 'teşekkürler' } });

    const list = (await env.app.inject({ method: 'GET', url: '/api/artifacts', headers: auth(a) })).json().artifacts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ chatId: chat.id, chatTitle: 'Oyun sohbeti', artifactId: 'yilan', title: 'Yılan Oyunu', kind: 'html', versions: 2 });
    expect((await env.app.inject({ method: 'GET', url: '/api/artifacts?q=zzz', headers: auth(a) })).json().artifacts).toHaveLength(0);
    expect((await env.app.inject({ method: 'GET', url: '/api/artifacts', headers: auth(b) })).json().artifacts).toHaveLength(0);
  });
});
