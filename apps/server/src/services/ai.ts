import type { Config } from '../config.ts';
import type { ChatMode } from '@sixfinger/shared';
import { HttpError } from '../lib/errors.ts';
import { bedrockConfigured, createBedrock } from './bedrock.ts';

/** Modelin istediği bir araç çağrısı (OpenAI uyumlu biçim). `arguments` JSON metnidir. */
export interface AiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AiToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Yalnızca asistan: bu turda istenen araç çağrıları. */
  tool_calls?: AiToolCall[];
  /** Yalnızca tool: hangi çağrının sonucu. */
  tool_call_id?: string;
}

export type Effort = 'low' | 'medium' | 'high';

export interface AiRequest {
  messages: AiMessage[];
  signal?: AbortSignal;
  /** Hangi modelin yanıtlayacağı. Verilmezse Hızlı. */
  mode?: ChatMode;
  /** Düşünme düzeyi; yalnızca bunu destekleyen modele gönderilir. */
  effort?: Effort;
  temperature?: number;
  maxTokens?: number;
  tools?: AiToolSpec[];
  /** Dahili: arkasında yedek sağlayıcı olduğunda bekleyip yeniden denemek yerine hemen başarısız ol. */
  failFast?: boolean;
  /** Araç turlarının devamında: hız sınırına takılınca daha uzun beklemeyi göze al. */
  patient?: boolean;
}

export type AiChunk =
  | { type: 'reasoning'; text: string }
  | { type: 'content'; text: string }
  /** Akış bitince, model araç çağırmak istediyse bir kez gelir. */
  | { type: 'tool_calls'; calls: AiToolCall[] };

export interface AiProvider {
  stream(req: AiRequest): AsyncGenerator<AiChunk, void, void>;
  complete(req: AiRequest): Promise<string>;
}

/** Eşzamanlı üst akış isteklerini sınırlar. Kuyrukta çok bekleyen istek `upstream_busy` alır. */
class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private max: number) {}

  async acquire(signal: AbortSignal | undefined, maxWaitMs: number): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new HttpError(503, 'upstream_busy', 'Şu an çok yoğunuz. Birkaç saniye sonra tekrar dene.'));
      }, maxWaitMs);
      const onAbort = () => {
        cleanup();
        reject(new DOMException('aborted', 'AbortError'));
      };
      const waiter = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.waiters = this.waiters.filter((w) => w !== waiter);
      };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    this.active++;
    return () => this.release();
  }

  private release() {
    this.active--;
    this.waiters.shift()?.();
  }
}

const RETRYABLE = new Set([402, 408, 425, 429, 500, 502, 503, 504, 524]);
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

type Logger = { warn: (obj: object, msg: string) => void };

/** Tek bir OpenAI uyumlu uç nokta + model. */
interface Profile {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** `reasoning_effort` yalnızca bunu destekleyen modele gönderilir (Llama reddediyor, Qwen boş yanıt veriyor). */
  sendEffort: boolean;
}

function createEndpoint(profile: Profile, config: Config, log: Logger, fetchImpl: typeof fetch): AiProvider {
  const gate = new Semaphore(config.AI_MAX_CONCURRENCY);

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (profile.apiKey) h.authorization = `Bearer ${profile.apiKey}`;
    return h;
  }

  function body(req: AiRequest, stream: boolean) {
    return JSON.stringify({
      model: profile.model,
      messages: req.messages,
      stream,
      temperature: req.temperature ?? 0.7,
      ...(profile.sendEffort ? { reasoning_effort: req.effort ?? 'medium' } : {}),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
    });
  }

  // Pollinations anonim katmanı IP başına kısa bir bekleme uygular (402/429). Aralıklı yeniden denenir.
  const THROTTLE_DELAYS = [1_500, 3_000, 5_000, 8_000];
  const PATIENT_THROTTLE_DELAYS = [3_000, 5_000, 8_000, 12_000, 15_000];
  const ERROR_DELAYS = [800, 2_000];
  let lastStart = 0;
  const MIN_GAP_MS = 600;

  async function pace(signal?: AbortSignal) {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    lastStart = Math.max(Date.now(), lastStart + MIN_GAP_MS);
    if (wait > 0) await sleep(wait, signal);
  }

  /** Başarılı bir yanıt alana kadar (ya da vazgeçene dek) isteği dener. */
  async function open(req: AiRequest, stream: boolean): Promise<Response> {
    let throttled = 0;
    let failed = 0;
    let lastStatus = 0;
    for (;;) {
      await pace(req.signal);
      const timeout = AbortSignal.timeout(config.AI_TIMEOUT_MS);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      let res: Response | undefined;
      try {
        res = await fetchImpl(profile.baseUrl, {
          method: 'POST',
          headers: headers(),
          body: body(req, stream),
          signal,
        });
      } catch (err) {
        if (req.signal?.aborted) throw err;
      }
      if (res?.ok) return res;

      let delay: number | undefined;
      if (res) {
        lastStatus = res.status;
        const retryAfter = Number(res.headers.get('retry-after'));
        const snippet = (await res.text().catch(() => '')).slice(0, 300);
        log.warn(
          { status: res.status, retryAfter: res.headers.get('retry-after'), body: snippet },
          'üst servis hatası',
        );
        if (!RETRYABLE.has(res.status)) {
          throw new HttpError(502, 'upstream_unavailable', `Yapay zekâ servisi hata verdi (${res.status}).`);
        }
        const throttleStatus = res.status === 402 || res.status === 429;
        const throttleDelays = req.failFast ? [] : req.patient ? PATIENT_THROTTLE_DELAYS : THROTTLE_DELAYS;
        delay = throttleStatus ? throttleDelays[throttled++] : ERROR_DELAYS[failed++];
        if (delay !== undefined && Number.isFinite(retryAfter) && retryAfter > 0) {
          delay = Math.max(delay, Math.min(retryAfter * 1_000, req.patient ? 20_000 : 10_000));
        }
      } else {
        delay = ERROR_DELAYS[failed++];
      }
      // Yedek varsa tek bir kısa yeniden denemeden sonra pes et.
      if (req.failFast && failed + throttled > 1) delay = undefined;
      if (delay === undefined) break;
      await sleep(delay + Math.floor(Math.random() * 250), req.signal);
    }
    if (lastStatus === 402 || lastStatus === 429) {
      throw new HttpError(503, 'upstream_busy', 'Yapay zekâ servisi şu an yoğun. Birkaç saniye sonra tekrar dene.');
    }
    throw new HttpError(502, 'upstream_unavailable', 'Yapay zekâ servisine ulaşılamadı.');
  }

  async function* stream(req: AiRequest): AsyncGenerator<AiChunk, void, void> {
    const release = await gate.acquire(req.signal, 25_000);
    try {
      const res = await open(req, true);
      if (!res.body) throw new HttpError(502, 'upstream_unavailable', 'Boş yanıt alındı.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const calls = new Map<number, AiToolCall>();
      let sawContent = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let json: any;
            try {
              json = JSON.parse(data);
            } catch {
              continue;
            }
            if (json.error) {
              throw new HttpError(502, 'upstream_unavailable', 'Yapay zekâ servisi bir hata bildirdi.');
            }
            const delta = json.choices?.[0]?.delta;
            if (!delta) continue;
            const reasoning = delta.reasoning ?? delta.reasoning_content;
            if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
            if (typeof delta.content === 'string' && delta.content) {
              // Bazı modeller (Qwen) yanıtı boş satırlarla başlatır.
              const text = sawContent ? delta.content : delta.content.trimStart();
              if (text) {
                sawContent = true;
                yield { type: 'content', text };
              }
            }
            // Araç çağrıları parça parça gelir: `index` ile birleştirilir.
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const i = typeof tc.index === 'number' ? tc.index : 0;
                const cur = calls.get(i) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.function.name += tc.function.name;
                if (typeof tc.function?.arguments === 'string') cur.function.arguments += tc.function.arguments;
                calls.set(i, cur);
              }
            }
          }
        }
        if (calls.size) {
          const list = [...calls.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, c], n) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${n}` }))
            .filter((c) => c.function.name);
          if (list.length) yield { type: 'tool_calls', calls: list };
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    } finally {
      release();
    }
  }

  async function complete(req: AiRequest): Promise<string> {
    const release = await gate.acquire(req.signal, 25_000);
    try {
      const res = await open(req, false);
      const json: any = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    } finally {
      release();
    }
  }

  return { stream, complete };
}

/**
 * Çalışma moduna göre sağlayıcı seçer: fast → Pollinations, balanced → gpt-oss-120b, deep → Qwen3.8.
 * Seçilen sağlayıcı yanıt vermeye başlamadan başarısız olursa (200 dışı yanıt, hız sınırı, kesinti, boş yanıt) sırayla
 * Bedrock'taki Claude'a (yapılandırıldıysa), sonra Hızlı sağlayıcıya düşülür.
 */
export function createAi(
  config: Config,
  log: Logger = { warn: () => {} },
  fetchImpl: typeof fetch = fetch,
  bedrockImpl?: AiProvider,
): AiProvider {
  const fast = createEndpoint({ baseUrl: config.AI_BASE_URL, model: config.AI_MODEL, apiKey: config.AI_API_KEY, sendEffort: true }, config, log, fetchImpl);
  const make = (baseUrl: string, model: string, apiKey: string, sendEffort: boolean) =>
    baseUrl ? createEndpoint({ baseUrl, model, apiKey, sendEffort }, config, log, fetchImpl) : undefined;
  // gpt-oss `reasoning_effort` ister; Qwen3.8 bununla boş yanıt döner.
  const balanced = make(config.AI_BALANCED_BASE_URL, config.AI_BALANCED_MODEL, config.AI_BALANCED_API_KEY, true);
  const deep = make(config.AI_DEEP_BASE_URL, config.AI_DEEP_MODEL, config.AI_DEEP_API_KEY, false);
  const backup = bedrockImpl ?? (bedrockConfigured(config) ? createBedrock(config) : undefined);

  /** Bu mod için denenecek sağlayıcılar, sırayla: seçilen model → Bedrock (varsa) → Hızlı. */
  const chain = (mode: ChatMode | undefined): Array<{ name: string; ai: AiProvider }> => {
    const main = mode === 'deep' ? deep : mode === 'balanced' ? balanced : undefined;
    const all = [
      main && { name: mode ?? 'main', ai: main },
      { name: 'fast', ai: fast },
      backup && { name: 'bedrock', ai: backup },
    ].filter(Boolean) as Array<{ name: string; ai: AiProvider }>;
    // Seçilen model Hızlı değilse Bedrock, Hızlı'dan önce gelir (daha güçlü yedek).
    if (main && backup) [all[1], all[2]] = [all[2]!, all[1]!];
    return all;
  };
  const aborted = (req: AiRequest, err: unknown) => req.signal?.aborted || (err as Error)?.name === 'AbortError';

  return {
    async *stream(req) {
      const list = chain(req.mode);
      for (const [i, p] of list.entries()) {
        const last = i === list.length - 1;
        let started = false;
        try {
          for await (const chunk of p.ai.stream(last ? req : { ...req, failFast: true })) {
            started = true;
            yield chunk;
          }
          if (started) return;
          if (last) return;
          log.warn({ mode: req.mode, provider: p.name }, 'sağlayıcı boş yanıt verdi, yedeğe düşülüyor');
        } catch (err) {
          if (started || last || aborted(req, err)) throw err;
          log.warn({ mode: req.mode, provider: p.name, err: String(err) }, 'sağlayıcı yanıt vermedi, yedeğe düşülüyor');
        }
      }
    },
    async complete(req) {
      const list = chain(req.mode);
      for (const [i, p] of list.entries()) {
        const last = i === list.length - 1;
        try {
          const out = await p.ai.complete(last ? req : { ...req, failFast: true });
          if (out || last) return out;
          log.warn({ mode: req.mode, provider: p.name }, 'sağlayıcı boş yanıt verdi, yedeğe düşülüyor');
        } catch (err) {
          if (last || aborted(req, err)) throw err;
          log.warn({ mode: req.mode, provider: p.name, err: String(err) }, 'sağlayıcı yanıt vermedi, yedeğe düşülüyor');
        }
      }
      return '';
    },
  };
}
