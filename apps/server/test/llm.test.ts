import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, guest, member, resetDb, setup, type TestEnv } from './helpers.ts';

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
  env.ai.steps.length = 0;
});

const coder = () => member(env, { email: 'coder@example.com' });
const post = (a: Awaited<ReturnType<typeof coder>>, payload: object) =>
  env.app.inject({ method: 'POST', url: '/api/llm/v1/chat/completions', headers: auth(a), payload });

describe('SixFinger Code model ucu', () => {
  it('modeller yalnızca fast ve deep', async () => {
    const a = await coder();
    const r = await env.app.inject({ method: 'GET', url: '/api/llm/v1/models', headers: auth(a) });
    expect(r.json().data.map((m: { id: string }) => m.id)).toEqual(['fast', 'deep']);
  });

  it('başka model adını reddeder (BYOK/serbest model yok)', async () => {
    const a = await coder();
    const r = await post(a, { model: 'gpt-5', messages: [{ role: 'user', content: 'selam' }] });
    expect(r.statusCode).toBe(400);
  });

  it('akışsız yanıt OpenAI biçiminde, Code zinciriyle çağrılır', async () => {
    const a = await coder();
    const r = await post(a, { model: 'deep', messages: [{ role: 'user', content: 'selam' }] });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.choices[0].message).toMatchObject({ role: 'assistant', content: 'Merhaba dünya!', reasoning_content: 'Düşünüyorum' });
    expect(j.choices[0].finish_reason).toBe('stop');
    expect(env.ai.calls[0]).toMatchObject({ route: 'code', mode: 'deep' });
  });

  it('araç çağrısını geçirir ve finish_reason=tool_calls verir', async () => {
    const a = await coder();
    env.ai.steps.push([{ type: 'tool_calls', calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }] }]);
    const r = await post(a, {
      model: 'fast',
      messages: [{ role: 'user', content: 'a dosyasını oku' }],
      tools: [{ type: 'function', function: { name: 'read', description: 'oku', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
    });
    const c = r.json().choices[0];
    expect(c.finish_reason).toBe('tool_calls');
    expect(c.message.tool_calls[0].function.name).toBe('read');
    expect(env.ai.calls[0]!.tools?.[0]?.function.name).toBe('read');
  });

  it('akışlı yanıt SSE parçaları ve [DONE] döner', async () => {
    const a = await coder();
    const r = await post(a, { model: 'fast', stream: true, messages: [{ role: 'user', content: 'selam' }] });
    expect(r.headers['content-type']).toContain('text/event-stream');
    expect(r.body).toContain('"content":"Merhaba "');
    expect(r.body).toContain('"finish_reason":"stop"');
    expect(r.body.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('görseli yalnızca data: URL olarak kabul eder', async () => {
    const a = await coder();
    const bad = await post(a, { model: 'fast', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }] });
    expect(bad.statusCode).toBe(400);
    const ok = await post(a, { model: 'fast', messages: [{ role: 'user', content: [{ type: 'text', text: 'bu ne' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }] });
    expect(ok.statusCode).toBe(200);
    expect(env.ai.calls[0]!.messages[0]!.images?.[0]).toMatchObject({ mime: 'image/png', data: 'AAAA' });
  });

  it('misafir ve izinsiz üye kullanamaz', async () => {
    const g = await guest(env.app);
    expect((await post(g, { messages: [{ role: 'user', content: 'x' }] })).statusCode).toBeGreaterThanOrEqual(401);
    const m = await member(env);
    expect((await post(m, { messages: [{ role: 'user', content: 'x' }] })).statusCode).toBe(403);
  });

  it('web araması: sunucunun kendi aramasıyla sonuç döner; kural dışı istek reddedilir', async () => {
    const a = await coder();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"results":[{"title":"SixFinger","url":"https://example.com/a","content":"özet"}]}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const bad = await env.app.inject({ method: 'POST', url: '/api/llm/v1/web_search', headers: auth(a), payload: { query: '' } });
      expect(bad.statusCode).toBe(400);
      const m = await member(env);
      expect((await env.app.inject({ method: 'POST', url: '/api/llm/v1/web_search', headers: auth(m), payload: { query: 'x' } })).statusCode).toBe(403);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
