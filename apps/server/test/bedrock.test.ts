import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { createAi, type AiChunk, type AiProvider } from '../src/services/ai.ts';
import { bedrockConfigured, createBedrock, toConverse, type BedrockSender } from '../src/services/bedrock.ts';

const base = loadConfig();
const cfg = { ...base, BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6', BEDROCK_API_KEY: 'k' };

async function* events(list: object[]) {
  for (const e of list) yield e;
}
const collect = async (it: AsyncIterable<AiChunk>) => {
  const out: AiChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
};

describe('toConverse', () => {
  it('sistemi ayırır, araç çağrısı/sonucunu eşler, aynı roldeki mesajları birleştirir', () => {
    const { system, messages } = toConverse([
      { role: 'system', content: 'Sen SixFinger AI\'sin.' },
      { role: 'user', content: 'Hava?' },
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'web_search', arguments: '{"query":"hava"}' } }, { id: 't2', type: 'function', function: { name: 'web_fetch', arguments: 'bozuk' } }] },
      { role: 'tool', content: 'sonuç 1', tool_call_id: 't1' },
      { role: 'tool', content: 'sonuç 2', tool_call_id: 't2' },
      { role: 'user', content: 'Özetle' },
    ]);
    expect(system).toEqual([{ text: "Sen SixFinger AI'sin." }]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1]!.content).toEqual([
      { toolUse: { toolUseId: 't1', name: 'web_search', input: { query: 'hava' } } },
      { toolUse: { toolUseId: 't2', name: 'web_fetch', input: {} } },
    ]);
    expect(messages[2]!.content).toEqual([
      { toolResult: { toolUseId: 't1', content: [{ text: 'sonuç 1' }] } },
      { toolResult: { toolUseId: 't2', content: [{ text: 'sonuç 2' }] } },
      { text: 'Özetle' },
    ]);
  });

  it('boş metinleri atar ve asistan mesajıyla başlayan geçmişin başına kullanıcı turu koyar', () => {
    const { messages } = toConverse([
      { role: 'assistant', content: 'Merhaba' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'selam' },
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2]!.content).toEqual([{ text: 'selam' }]);
  });
});

describe('Bedrock sağlayıcısı', () => {
  it('akıştaki metni ve parça parça gelen araç çağrısını birleştirir', async () => {
    let sent: any;
    const sender: BedrockSender = {
      async send(cmd) {
        sent = (cmd as any).input;
        return {
          stream: events([
            { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Bakayım' } } },
            { contentBlockStart: { contentBlockIndex: 1, start: { toolUse: { toolUseId: 'tu1', name: 'web_search' } } } },
            { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '{"query":' } } } },
            { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '"hava"}' } } } },
            { messageStop: { stopReason: 'tool_use' } },
          ]),
        };
      },
    };
    const ai = createBedrock(cfg, sender);
    const out = await collect(
      ai.stream({
        messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'x' }],
        tools: [{ type: 'function', function: { name: 'web_search', description: 'ara', parameters: { type: 'object', properties: {} } } }],
      }),
    );
    expect(out).toEqual([
      { type: 'content', text: 'Bakayım' },
      { type: 'tool_calls', calls: [{ id: 'tu1', type: 'function', function: { name: 'web_search', arguments: '{"query":"hava"}' } }] },
    ]);
    expect(sent.modelId).toBe('us.anthropic.claude-sonnet-4-6');
    expect(sent.system).toEqual([{ text: 's' }]);
    expect(sent.toolConfig.tools[0].toolSpec.name).toBe('web_search');
  });

  it('kısıtlama hatasını upstream_busy olarak bildirir', async () => {
    const sender: BedrockSender = {
      async send() {
        throw Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
      },
    };
    await expect(createBedrock(cfg, sender).complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'upstream_busy' });
  });

  it('yalnızca model kimliği ve kimlik bilgisi varsa yapılandırılmış sayılır', () => {
    expect(bedrockConfigured(base)).toBe(false);
    expect(bedrockConfigured({ ...base, BEDROCK_MODEL_ID: 'm' })).toBe(false);
    expect(bedrockConfigured(cfg)).toBe(true);
    expect(bedrockConfigured({ ...base, BEDROCK_MODEL_ID: 'm', BEDROCK_ACCESS_KEY_ID: 'a', BEDROCK_SECRET_ACCESS_KEY: 's' })).toBe(true);
  });
});

describe('yedek zinciri', () => {
  const fake = (name: string, calls: string[], behavior: 'ok' | 'fail' | 'empty'): AiProvider => ({
    async *stream() {
      calls.push(name);
      if (behavior === 'fail') throw new Error(`${name} düştü`);
      if (behavior === 'ok') yield { type: 'content', text: name };
    },
    async complete() {
      calls.push(name);
      if (behavior === 'fail') throw new Error(`${name} düştü`);
      return behavior === 'ok' ? name : '';
    },
  });
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'fast' } }] }), { status: 200 });

  it('Hızlı 429 verince hemen (bekleyip denemeden) Bedrock\'a düşer', async () => {
    let upstreamCalls = 0;
    const fetchMock = async () => {
      upstreamCalls++;
      return new Response('{}', { status: 429 });
    };
    const calls: string[] = [];
    const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch, fake('bedrock', calls, 'ok'));
    const t0 = Date.now();
    expect(await collect(ai.stream({ messages: [{ role: 'user', content: 'x' }], mode: 'fast' }))).toEqual([{ type: 'content', text: 'bedrock' }]);
    expect(upstreamCalls).toBe(1);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('Derin 200 dışı verirse Bedrock, o da düşerse Hızlı denenir', async () => {
    const urls: string[] = [];
    const fetchMock = async (url: string) => {
      urls.push(url);
      return url === cfg.AI_DEEP_BASE_URL ? new Response('{}', { status: 400 }) : ok();
    };
    const calls: string[] = [];
    const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch, fake('bedrock', calls, 'fail'));
    expect(await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'deep' })).toBe('fast');
    expect(calls).toEqual(['bedrock']);
    expect(urls.at(-1)).toBe(cfg.AI_BASE_URL);
  });

  it('boş (200 ama içeriksiz) yanıt da yedeğe düşürür', async () => {
    const empty = () => new Response('data: [DONE]\n\n', { status: 200 });
    const calls: string[] = [];
    const ai = createAi(cfg, undefined, (async () => empty()) as unknown as typeof fetch, fake('bedrock', calls, 'ok'));
    expect(await collect(ai.stream({ messages: [{ role: 'user', content: 'x' }], mode: 'fast' }))).toEqual([{ type: 'content', text: 'bedrock' }]);
  });

  it('yedek tanımlı değilse eski davranış: Hızlı denenir', async () => {
    const ai = createAi({ ...cfg, BEDROCK_MODEL_ID: '' }, undefined, (async () => ok()) as unknown as typeof fetch);
    expect(await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'fast' })).toBe('fast');
  });

  it('yanıt akmaya başladıktan sonra hata yedeğe düşmez', async () => {
    const half: AiProvider = {
      async *stream() {
        yield { type: 'content', text: 'yarım' };
        throw new Error('koptu');
      },
      async complete() {
        return '';
      },
    };
    // Hızlı sağlayıcı (fetch) 500 verir ama Bedrock yarım yanıt akıtıp koparsa hata yukarı çıkmalı.
    const ai = createAi(cfg, undefined, (async () => new Response('x', { status: 500 })) as unknown as typeof fetch, half);
    const out: AiChunk[] = [];
    await expect(
      (async () => {
        for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }], mode: 'deep' })) out.push(c);
      })(),
    ).rejects.toThrow('koptu');
    expect(out).toEqual([{ type: 'content', text: 'yarım' }]);
  });
});
