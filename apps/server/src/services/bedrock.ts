import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseStreamCommandOutput,
  type Message,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';
import type { Config } from '../config.ts';
import { HttpError } from '../lib/errors.ts';
import type { AiChunk, AiMessage, AiProvider, AiRequest, AiToolCall } from './ai.ts';

/** Test için: gerçek istemci yerine konabilen asgari arayüz. */
export interface BedrockSender {
  send(command: ConverseCommand | ConverseStreamCommand, opts?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

const DEFAULT_MAX_TOKENS = 8192;

const text = (t: string): ContentBlock => ({ text: t });

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * OpenAI biçimli geçmişi Converse biçimine çevirir: sistem metni ayrılır, araç sonuçları kullanıcı turuna girer,
 * art arda aynı roldeki mesajlar birleşir (Converse rol değişimi ister) ve boş metin blokları atılır.
 */
export function toConverse(messages: AiMessage[]): { system: Array<{ text: string }>; messages: Message[] } {
  const system: Array<{ text: string }> = [];
  const out: Message[] = [];
  const push = (role: 'user' | 'assistant', content: ContentBlock[]) => {
    if (!content.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = [...(last.content ?? []), ...content];
    else out.push({ role, content });
  };
  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content.trim()) system.push({ text: m.content });
    } else if (m.role === 'user') {
      push('user', m.content.trim() ? [text(m.content)] : []);
    } else if (m.role === 'assistant') {
      const blocks: ContentBlock[] = [];
      if (m.content.trim()) blocks.push(text(m.content));
      for (const tc of m.tool_calls ?? []) blocks.push({ toolUse: { toolUseId: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) as never } });
      push('assistant', blocks);
    } else {
      push('user', [{ toolResult: { toolUseId: m.tool_call_id ?? '', content: [{ text: m.content || '(boş)' }] } }]);
    }
  }
  // Converse konuşmanın kullanıcı turuyla başlamasını ister.
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [text('.')] });
  return { system, messages: out };
}

function toolConfig(req: AiRequest): ToolConfiguration | undefined {
  if (!req.tools?.length) return undefined;
  return {
    tools: req.tools.map((t) => ({
      toolSpec: { name: t.function.name, description: t.function.description, inputSchema: { json: t.function.parameters as never } },
    })),
    toolChoice: { auto: {} },
  };
}

function input(req: AiRequest, modelId: string) {
  const { system, messages } = toConverse(req.messages);
  return {
    modelId,
    messages,
    ...(system.length ? { system } : {}),
    inferenceConfig: { maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS, temperature: req.temperature ?? 0.7 },
    ...(toolConfig(req) ? { toolConfig: toolConfig(req) } : {}),
  };
}

function upstreamError(err: unknown): HttpError {
  const name = (err as { name?: string })?.name ?? '';
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (name === 'ThrottlingException' || name === 'ServiceQuotaExceededException' || status === 429) {
    return new HttpError(503, 'upstream_busy', 'Yedek yapay zekâ servisi şu an yoğun.');
  }
  return new HttpError(502, 'upstream_unavailable', 'Yedek yapay zekâ servisine ulaşılamadı.');
}

export function bedrockConfigured(config: Config): boolean {
  return !!(config.BEDROCK_MODEL_ID && (config.BEDROCK_API_KEY || (config.BEDROCK_ACCESS_KEY_ID && config.BEDROCK_SECRET_ACCESS_KEY)));
}

/** Bedrock üzerindeki Claude (Converse API). Yalnızca yedek olarak kullanılır: Hızlı/Dengeli/Derin başarısız olursa. */
export function createBedrock(config: Config, sender?: BedrockSender): AiProvider {
  const client: BedrockSender =
    sender ??
    new BedrockRuntimeClient({
      region: config.BEDROCK_REGION,
      maxAttempts: 2,
      ...(config.BEDROCK_API_KEY
        ? { token: { token: config.BEDROCK_API_KEY }, authSchemePreference: ['httpBearerAuth'] }
        : {
            credentials: {
              accessKeyId: config.BEDROCK_ACCESS_KEY_ID,
              secretAccessKey: config.BEDROCK_SECRET_ACCESS_KEY,
              ...(config.BEDROCK_SESSION_TOKEN ? { sessionToken: config.BEDROCK_SESSION_TOKEN } : {}),
            },
          }),
    });
  const modelId = config.BEDROCK_MODEL_ID;

  async function* stream(req: AiRequest): AsyncGenerator<AiChunk, void, void> {
    let res: ConverseStreamCommandOutput;
    try {
      res = (await client.send(new ConverseStreamCommand(input(req, modelId)), { abortSignal: req.signal })) as ConverseStreamCommandOutput;
    } catch (err) {
      if (req.signal?.aborted) throw err;
      throw upstreamError(err);
    }
    if (!res.stream) throw new HttpError(502, 'upstream_unavailable', 'Boş yanıt alındı.');
    const calls = new Map<number, AiToolCall>();
    try {
      for await (const ev of res.stream) {
        const idx = ev.contentBlockStart?.contentBlockIndex ?? ev.contentBlockDelta?.contentBlockIndex ?? 0;
        const tu = ev.contentBlockStart?.start?.toolUse;
        if (tu) calls.set(idx, { id: tu.toolUseId ?? '', type: 'function', function: { name: tu.name ?? '', arguments: '' } });
        const delta = ev.contentBlockDelta?.delta;
        if (delta?.text) yield { type: 'content', text: delta.text };
        else if (delta?.reasoningContent?.text) yield { type: 'reasoning', text: delta.reasoningContent.text };
        else if (delta?.toolUse?.input !== undefined) {
          const cur = calls.get(idx);
          if (cur) cur.function.arguments += delta.toolUse.input;
        }
      }
    } catch (err) {
      if (req.signal?.aborted) throw err;
      throw upstreamError(err);
    }
    const list = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c], n) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${n}` }));
    if (list.length) yield { type: 'tool_calls', calls: list };
  }

  async function complete(req: AiRequest): Promise<string> {
    try {
      const res = (await client.send(new ConverseCommand(input(req, modelId)), { abortSignal: req.signal })) as {
        output?: { message?: { content?: ContentBlock[] } };
      };
      return (res.output?.message?.content ?? []).map((b) => ('text' in b && typeof b.text === 'string' ? b.text : '')).join('');
    } catch (err) {
      if (req.signal?.aborted) throw err;
      throw upstreamError(err);
    }
  }

  return { stream, complete };
}
