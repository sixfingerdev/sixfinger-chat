import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { createPollinations } from '../src/services/ai.ts';

const config = loadConfig();
const sse = (chunks: object[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
const delta = (d: object) => ({ choices: [{ index: 0, delta: d }] });

describe('Pollinations sağlayıcısı', () => {
  it('akıştaki reasoning ve content parçalarını ayırır', async () => {
    const fetchMock = async () =>
      sse([delta({ role: 'assistant', content: '' }), delta({ reasoning: 'hmm' }), delta({ content: 'Mer' }), delta({ content: 'haba' })]);
    const ai = createPollinations(config, undefined, fetchMock as unknown as typeof fetch);
    const out: Array<[string, string]> = [];
    for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }] })) if (c.type !== 'tool_calls') out.push([c.type, c.text]);
    expect(out).toEqual([
      ['reasoning', 'hmm'],
      ['content', 'Mer'],
      ['content', 'haba'],
    ]);
  });

  it('parça parça gelen araç çağrılarını birleştirir', async () => {
    const tc = (o: object) => delta({ tool_calls: [o] });
    const fetchMock = async () =>
      sse([
        tc({ index: 0, id: 'c1', type: 'function', function: { name: 'web_search', arguments: '' } }),
        tc({ index: 0, function: { arguments: '{"query":"is' } }),
        tc({ index: 0, function: { arguments: 'tanbul"}' } }),
        tc({ index: 1, id: 'c2', type: 'function', function: { name: 'web_fetch', arguments: '{"url":"https://a.com"}' } }),
      ]);
    const ai = createPollinations(config, undefined, fetchMock as unknown as typeof fetch);
    const calls = [];
    for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }] })) if (c.type === 'tool_calls') calls.push(...c.calls);
    expect(calls.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ['c1', 'web_search', '{"query":"istanbul"}'],
      ['c2', 'web_fetch', '{"url":"https://a.com"}'],
    ]);
  });

  it('araçlar istekte tools olarak gönderilir', async () => {
    let sent: any;
    const fetchMock = async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return sse([delta({ content: 'ok' })]);
    };
    const ai = createPollinations(config, undefined, fetchMock as unknown as typeof fetch);
    const tools = [{ type: 'function' as const, function: { name: 't', description: 'd', parameters: { type: 'object' } } }];
    for await (const _ of ai.stream({ messages: [{ role: 'user', content: 'x' }], tools })) void _;
    expect(sent.tools).toEqual(tools);
    expect(sent.tool_choice).toBe('auto');
  });

  it('402 (anonim bekleme) sonrası yeniden dener ve başarır', async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls++;
      return calls === 1 ? new Response('{}', { status: 402 }) : sse([delta({ content: 'tamam' })]);
    };
    const ai = createPollinations(config, undefined, fetchMock as unknown as typeof fetch);
    let text = '';
    for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }] })) if (c.type === 'content') text += c.text;
    expect(text).toBe('tamam');
    expect(calls).toBe(2);
  });

  it('kalıcı 4xx hatasında yeniden denemeden hata verir', async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls++;
      return new Response('{}', { status: 400 });
    };
    const ai = createPollinations(config, undefined, fetchMock as unknown as typeof fetch);
    await expect(ai.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      code: 'upstream_unavailable',
    });
    expect(calls).toBe(1);
  });

  it('istek gövdesi model, akış ve düşünme derinliğini içerir', async () => {
    let sent: any;
    const fetchMock = async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    };
    const ai = createPollinations(config, undefined, fetchMock as unknown as typeof fetch);
    expect(await ai.complete({ messages: [{ role: 'user', content: 'x' }], effort: 'low' })).toBe('ok');
    expect(sent).toMatchObject({ model: 'openai-fast', stream: false, reasoning_effort: 'low' });
  });

  it('iptal sinyali beklemeyi keser', async () => {
    const fetchMock = async () => new Response('{}', { status: 402 });
    const ai = createPollinations(config, undefined, fetchMock as unknown as typeof fetch);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await expect(
      (async () => {
        for await (const _ of ai.stream({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal })) void _;
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
