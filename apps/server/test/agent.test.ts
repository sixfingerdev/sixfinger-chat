import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatDetailDTO, MessageDTO, StreamEvent } from '@sixfinger/shared';
import type { AiChunk } from '../src/services/ai.ts';
import type { ToolDef } from '../src/services/tools/index.ts';
import { ToolError } from '../src/services/tools/index.ts';
import { auth, guest, member, newChat, parseSse, resetDb, setup, type TestEnv } from './helpers.ts';

const echo: ToolDef = {
  name: 'test_echo',
  description: 'Verilen metni geri döndürür (test).',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  available: () => true,
  async run(args) {
    const text = String((args as { text?: string }).text ?? '');
    if (text === 'patla') throw new ToolError('Zorla hata');
    return { output: `ECHO:${text}`, summary: text };
  },
};

let env: TestEnv;
beforeAll(async () => {
  env = await setup([echo]);
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb(env.ctx);
  env.ai.calls.length = 0;
  env.ai.steps.length = 0;
  env.ai.failWith = null;
  env.ai.completeText = 'Araç Sohbeti';
});

const call = (id: string, name: string, args: object | string): AiChunk => ({
  type: 'tool_calls',
  calls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }],
});
const text = (t: string): AiChunk => ({ type: 'content', text: t });

async function send(a: Awaited<ReturnType<typeof guest>>, chatId: string, content = 'Selam') {
  const r = await env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload: { content } });
  return { status: r.statusCode, events: r.statusCode === 200 ? parseSse(r.body) : ([] as StreamEvent[]) };
}
const detail = async (a: Awaited<ReturnType<typeof guest>>, id: string) =>
  (await env.app.inject({ method: 'GET', url: `/api/chats/${id}`, headers: auth(a) })).json() as ChatDetailDTO;
const last = (d: ChatDetailDTO): MessageDTO => d.messages.filter((m) => m.role === 'assistant').at(-1)!;

describe('ajan döngüsü', () => {
  it('araç çağırır, sonucu modele geri verir ve parçaları sırayla kaydeder', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.steps = [[text('Bakayım. '), call('c1', 'test_echo', { text: 'merhaba' })], [text('Sonuç: merhaba')]];
    const { status, events } = await send(m, chat.id);
    expect(status).toBe(200);

    const types = events.map((e) => e.type);
    expect(types.indexOf('tool_start')).toBeGreaterThan(types.indexOf('delta'));
    expect(types.indexOf('tool_end')).toBeGreaterThan(types.indexOf('tool_start'));
    expect(events.find((e) => e.type === 'tool_start')).toMatchObject({ id: 'c1', name: 'test_echo', args: { text: 'merhaba' } });
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({ id: 'c1', status: 'done', output: 'ECHO:merhaba', summary: 'merhaba' });

    const msg = last(await detail(m, chat.id));
    expect(msg.status).toBe('complete');
    expect(msg.content).toBe('Bakayım. Sonuç: merhaba');
    expect(msg.parts.map((p) => p.type)).toEqual(['text', 'tool', 'text']);
    expect(msg.parts[1]).toMatchObject({ type: 'tool', id: 'c1', status: 'done', output: 'ECHO:merhaba' });

    // Ana akış 2 çağrı (tur 1: araç isteği, tur 2: cevap); ayrıca başlık için complete().
    const streamCalls = env.ai.calls.filter((c) => c.messages[0]?.role === 'system' && c.messages[0].content.includes('SixFinger AI'));
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[0]!.tools?.map((t) => t.function.name)).toContain('test_echo');
    const second = streamCalls[1]!.messages;
    const asst = second.find((x) => x.role === 'assistant' && x.tool_calls);
    expect(asst?.tool_calls?.[0]?.function.name).toBe('test_echo');
    expect(second.find((x) => x.role === 'tool')).toMatchObject({ tool_call_id: 'c1', content: 'ECHO:merhaba' });
  });

  it('araç hatası ve bozuk JSON modele hata olarak döner, tur devam eder', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.steps = [[call('a', 'test_echo', { text: 'patla' })], [call('b', 'test_echo', '{bozuk')], [text('Toparladım.')]];
    const { events } = await send(m, chat.id);
    const ends = events.filter((e) => e.type === 'tool_end');
    expect(ends).toHaveLength(2);
    expect(ends[0]).toMatchObject({ status: 'error', output: 'Hata: Zorla hata' });
    expect(ends[1]).toMatchObject({ status: 'error' });
    expect(last(await detail(m, chat.id)).content).toBe('Toparladım.');
  });

  it('son turda araç verilmez; model cevap yazmak zorunda kalır', async () => {
    const g = await guest(env.app); // misafir: 4 tur
    const chat = await newChat(env.app, g);
    env.ai.steps = [
      [call('1', 'test_echo', { text: 'a' })],
      [call('2', 'test_echo', { text: 'b' })],
      [call('3', 'test_echo', { text: 'c' })],
      [text('Bitti.')],
    ];
    await send(g, chat.id);
    const main = env.ai.calls.filter((c) => c.messages[0]?.content.includes('SixFinger AI'));
    expect(main).toHaveLength(4);
    expect(main.slice(0, 3).every((c) => c.tools?.length)).toBe(true);
    expect(main[3]!.tools).toBeUndefined();
    expect(main.slice(1).every((c) => c.patient)).toBe(true);
    expect(main[0]!.patient).toBe(false);
  });

  it('sonraki mesajda geçmiş araç turlarıyla birlikte modele gider', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.steps = [[call('c1', 'test_echo', { text: 'x' })], [text('Birinci cevap')]];
    await send(m, chat.id, 'ilk');
    env.ai.calls.length = 0;
    env.ai.steps = [[text('İkinci cevap')]];
    await send(m, chat.id, 'ikinci');
    const msgs = env.ai.calls.find((c) => c.messages[0]?.content.includes('SixFinger AI'))!.messages;
    expect(msgs.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
    expect(msgs[2]!.tool_calls?.[0]?.id).toBe('c1');
    expect(msgs[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: 'ECHO:x' });
    expect(msgs[4]!.content).toBe('Birinci cevap');
  });

  it('araç sonucu olmadan boş bitmeyi hata sayar ama parçalar korunur', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    env.ai.steps = [[call('c1', 'test_echo', { text: 'x' })], []];
    const { events } = await send(m, chat.id);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const msg = last(await detail(m, chat.id));
    expect(msg.status).toBe('error');
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0]).toMatchObject({ type: 'tool', status: 'done' });
  });

  it('aynı turda en fazla 4 paralel çağrı çalışır', async () => {
    const m = await member(env);
    const chat = await newChat(env.app, m);
    const many: AiChunk = {
      type: 'tool_calls',
      calls: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, type: 'function' as const, function: { name: 'test_echo', arguments: JSON.stringify({ text: String(i) }) } })),
    };
    env.ai.steps = [[many], [text('ok')]];
    const { events } = await send(m, chat.id);
    expect(events.filter((e) => e.type === 'tool_end')).toHaveLength(4);
    const second = env.ai.calls.filter((c) => c.messages[0]?.content.includes('SixFinger AI'))[1]!.messages;
    expect(second.filter((x) => x.role === 'tool')).toHaveLength(6); // fazlalara hata cevabı verilir
  });
});
