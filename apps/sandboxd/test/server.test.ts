import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';
import { makeService } from './helpers.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

function setup(over: Record<string, string> = {}) {
  const s = makeService(over);
  cleanups.push(s.cleanup);
  const app = buildServer(s.service, s.cfg, { logger: false });
  const h = { authorization: `Bearer ${s.cfg.SANDBOXD_TOKEN}` };
  const post = (url: string, payload: object, headers: Record<string, string> = h) => app.inject({ method: 'POST', url, payload, headers });
  return { app, post, h };
}

describe('HTTP arayüzü', () => {
  it('yetkisiz istekleri reddeder; /healthz açıktır', async () => {
    const { app, post } = setup();
    expect((await post('/v1/exec', { user: 'u', session: 's', command: 'true' }, {})).statusCode).toBe(401);
    expect((await post('/v1/exec', { user: 'u', session: 's', command: 'true' }, { authorization: 'Bearer yanlis' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/stats' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it('exec / write / read / edit / files', async () => {
    const { post } = setup();
    const ex = await post('/v1/exec', { user: 'u', session: 's', command: 'echo selam' });
    expect(ex.statusCode).toBe(200);
    expect(ex.json()).toMatchObject({ exitCode: 0, stdout: 'selam\n' });

    expect((await post('/v1/write', { user: 'u', session: 's', path: 'a.txt', content: 'merhaba dünya' })).json()).toEqual({ bytes: 14 });
    expect((await post('/v1/read', { user: 'u', session: 's', path: 'a.txt' })).json()).toMatchObject({ content: 'merhaba dünya' });
    expect((await post('/v1/edit', { user: 'u', session: 's', path: 'a.txt', old_string: 'dünya', new_string: 'sandbox' })).json()).toMatchObject({ replacements: 1 });
    expect((await post('/v1/files', { user: 'u', session: 's' })).json().files).toEqual([{ path: 'a.txt', bytes: 15 }]);
  });

  it('hata kodlarını doğru eşler', async () => {
    const { post } = setup();
    expect((await post('/v1/read', { user: 'u', session: 's', path: 'yok.txt' })).statusCode).toBe(404);
    expect((await post('/v1/write', { user: 'u', session: 's', path: '../x', content: 'x' })).statusCode).toBe(400);
    expect((await post('/v1/exec', { user: 'u', session: 's' })).statusCode).toBe(400);
    expect((await post('/v1/exec', { user: 'u', session: 's', command: '' })).statusCode).toBe(400);
  });

  it('yoğunlukta 503 + Retry-After', async () => {
    const { post } = setup({ MAX_CONCURRENT_EXEC: '1', MAX_QUEUE: '0' });
    const slow = post('/v1/exec', { user: 'a', session: 'sa', command: 'sleep 0.5' });
    await new Promise((r) => setTimeout(r, 120));
    const r = await post('/v1/exec', { user: 'b', session: 'sb', command: 'true' });
    expect(r.statusCode).toBe(503);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.json().error.code).toBe('busy');
    await slow;
  });
});
