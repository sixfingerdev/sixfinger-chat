import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { creditsFor, weightedTokens } from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import type { AiImage, AiMessage, AiToolCall, AiToolSpec } from '../services/ai.ts';
import { HttpError, badRequest, forbidden } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

/**
 * SixFinger Code CLI'nin model ucu (OpenAI uyumlu `chat/completions`). CLI ajan döngüsünü cihazda çalıştırır, modeli buradan çağırır.
 * Yalnızca iki model vardır: `fast` (Hızlı) ve `deep` (Derin). Hangi gerçek modelin yanıtladığı sunucuda seçilir ve istemciye bildirilmez;
 * kredi Code ile aynı günlük havuzdan düşer.
 */

const MODELS = ['fast', 'deep'] as const;

const contentPart = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) }),
]);

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(contentPart), z.null()]).optional(),
  tool_calls: z
    .array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) }))
    .optional(),
  tool_call_id: z.string().optional(),
});

const bodySchema = z.object({
  model: z.string().default('fast'),
  messages: z.array(messageSchema).min(1).max(2_000),
  tools: z
    .array(z.object({ type: z.literal('function'), function: z.object({ name: z.string(), description: z.string().optional(), parameters: z.record(z.unknown()).optional() }) }))
    .max(128)
    .optional(),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().min(1).max(64_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
});

const DATA_URL = /^data:(image\/[a-z+.-]+);base64,(.+)$/i;

/** OpenAI içerik dizisini bizim mesaj biçimimize çevirir (görseller yalnızca data: URL; dış adrese istek yapmayız). */
function toAiMessage(m: z.infer<typeof messageSchema>): AiMessage {
  let text = '';
  const images: AiImage[] = [];
  if (typeof m.content === 'string') text = m.content;
  else if (Array.isArray(m.content)) {
    for (const p of m.content) {
      if (p.type === 'text') text += (text ? '\n' : '') + p.text;
      else {
        const d = DATA_URL.exec(p.image_url.url);
        if (!d) throw badRequest('Görseller data: URL olarak gönderilmeli.');
        images.push({ mime: d[1]!.toLowerCase(), data: d[2]! });
      }
    }
  }
  const out: AiMessage = { role: m.role, content: text };
  if (images.length > 0 && m.role === 'user') out.images = images.slice(0, 4);
  if (m.tool_calls?.length) out.tool_calls = m.tool_calls as AiToolCall[];
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  return out;
}

const approx = (s: string) => Math.ceil(s.length / 3.5);

export function llmRoutes(ctx: AppContext, guard: Guard) {
  const { ai, code } = ctx;

  return async function (app: FastifyInstance) {
    app.addHook('preHandler', guard.requireUser);

    app.get('/llm/v1/models', async () => ({
      object: 'list',
      data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'sixfinger' })),
    }));

    app.post('/llm/v1/chat/completions', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
      const user = req.user!;
      if (!code.enabled) throw new HttpError(503, 'upstream_unavailable', 'Code bu sunucuda ayarlanmamış.');
      if (!code.isAllowed(user)) throw forbidden('SixFinger Code için erişimin yok.');
      if (await code.creditsExhausted(user.id)) throw new HttpError(429, 'rate_limited', 'Bugünkü kredin bitti.');

      const body = parse(bodySchema, req.body);
      if (!(MODELS as readonly string[]).includes(body.model)) throw badRequest('Model yalnızca "fast" ya da "deep" olabilir.');
      const messages = body.messages.map(toAiMessage);
      const tools: AiToolSpec[] | undefined = body.tools?.map((t) => ({
        type: 'function',
        function: { name: t.function.name, description: t.function.description ?? '', parameters: t.function.parameters ?? { type: 'object', properties: {} } },
      }));

      const ac = new AbortController();
      reply.raw.on('close', () => ac.abort());
      let provider = 'qwen';
      const stream = ai.stream({
        messages,
        signal: ac.signal,
        mode: body.model === 'deep' ? 'deep' : 'fast',
        route: 'code',
        tools,
        effort: body.reasoning_effort,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        onProvider: (n) => (provider = n),
      });

      const id = `chatcmpl-${Math.random().toString(36).slice(2, 14)}`;
      const created = Math.floor(Date.now() / 1000);
      const model = body.model;
      const inChars = messages.reduce((n, m) => n + approx(m.content) + (m.tool_calls ? approx(JSON.stringify(m.tool_calls)) : 0) + (m.images?.length ?? 0) * 800, 0);
      let outTokens = 0;
      const charge = async () => {
        const amount = creditsFor({ model: provider === 'claude' ? 'claude' : 'qwen', tokens: weightedTokens(inChars, outTokens), diskUsedMb: 0, diskQuotaMb: 1 });
        if (amount > 0) await code.spend(user.id, amount).catch(() => undefined);
      };

      const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });

      if (body.stream) {
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
        const send = (o: unknown) => reply.raw.write(`data: ${JSON.stringify(o)}\n\n`);
        let finish: string = 'stop';
        try {
          send(chunk({ role: 'assistant' }));
          for await (const c of stream) {
            if (c.type === 'content') {
              outTokens += approx(c.text);
              send(chunk({ content: c.text }));
            } else if (c.type === 'reasoning') {
              outTokens += approx(c.text);
              send(chunk({ reasoning_content: c.text }));
            } else if (c.type === 'tool_calls') {
              finish = 'tool_calls';
              send(chunk({ tool_calls: c.calls.map((t, index) => ({ index, id: t.id, type: 'function', function: t.function })) }));
            } else if (c.type === 'truncated') finish = 'length';
          }
          send(chunk({}, finish));
          reply.raw.write('data: [DONE]\n\n');
        } catch (e) {
          if (!ac.signal.aborted) send({ error: { message: e instanceof HttpError ? e.message : 'Model yanıt veremedi.', type: 'upstream_error' } });
        } finally {
          reply.raw.end();
          await charge();
        }
        return;
      }

      let content = '';
      let reasoning = '';
      let calls: AiToolCall[] = [];
      let finish = 'stop';
      for await (const c of stream) {
        if (c.type === 'content') content += c.text;
        else if (c.type === 'reasoning') reasoning += c.text;
        else if (c.type === 'tool_calls') {
          calls = c.calls;
          finish = 'tool_calls';
        } else if (c.type === 'truncated') finish = 'length';
      }
      outTokens = approx(content + reasoning);
      await charge();
      const message: Record<string, unknown> = { role: 'assistant', content: content || null };
      if (reasoning) message.reasoning_content = reasoning;
      if (calls.length) message.tool_calls = calls;
      return { id, object: 'chat.completion', created, model, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: inChars, completion_tokens: outTokens, total_tokens: inChars + outTokens } };
    });
  };
}
