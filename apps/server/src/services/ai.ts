import type { Config } from '../config.ts';
import { HttpError } from '../lib/errors.ts';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type Effort = 'low' | 'medium' | 'high';

export interface AiRequest {
  messages: AiMessage[];
  signal?: AbortSignal;
  effort?: Effort;
  temperature?: number;
  maxTokens?: number;
}

export interface AiChunk {
  type: 'reasoning' | 'content';
  text: string;
}

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

export function createPollinations(
  config: Config,
  log: { warn: (obj: object, msg: string) => void } = { warn: () => {} },
  fetchImpl: typeof fetch = fetch,
): AiProvider {
  const gate = new Semaphore(config.AI_MAX_CONCURRENCY);

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (config.AI_API_KEY) h.authorization = `Bearer ${config.AI_API_KEY}`;
    return h;
  }

  function body(req: AiRequest, stream: boolean) {
    return JSON.stringify({
      model: config.AI_MODEL,
      messages: req.messages,
      stream,
      temperature: req.temperature ?? 0.7,
      reasoning_effort: req.effort ?? 'medium',
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    });
  }

  // Pollinations anonim katmanı IP başına kısa bir bekleme uygular (402/429). Aralıklı yeniden denenir.
  const THROTTLE_DELAYS = [1_500, 3_000, 5_000, 8_000];
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
        res = await fetchImpl(config.AI_BASE_URL, {
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
        delay = throttleStatus ? THROTTLE_DELAYS[throttled++] : ERROR_DELAYS[failed++];
        if (delay !== undefined && Number.isFinite(retryAfter) && retryAfter > 0) {
          delay = Math.max(delay, Math.min(retryAfter * 1_000, 10_000));
        }
      } else {
        delay = ERROR_DELAYS[failed++];
      }
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
            if (typeof delta.content === 'string' && delta.content) yield { type: 'content', text: delta.content };
          }
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
