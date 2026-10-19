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
  /** `code`: SixFinger Code zinciri (Qwen → Claude yedeği; zayıf Hızlı modele düşülmez). */
  route?: 'code';
  /** Hangi sağlayıcının yanıtlamaya başladığını bildirir (kredi ve kullanım için). */
  onProvider?: (name: string) => void;
}

export type AiChunk =
  | { type: 'reasoning'; text: string }
  | { type: 'content'; text: string }
  /** Akış bitince, model araç çağırmak istediyse bir kez gelir. */
  | { type: 'tool_calls'; calls: AiToolCall[] }
  /** Yanıt çıktı sınırına (max_tokens) takılıp kesildi. */
  | { type: 'truncated' };

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
  /** `AI_MAX_EFFORT` açıkken gönderilen düzey: modelin kabul ettiği en yükseği (gpt-oss `high`, DeepSeek/GLM/MiniMax `max`). */
  maxEffort?: 'high' | 'max';
  /** Anahtar isteğe bağlıdır: 401/402/403 gelirse bir süre anahtarsız denenir (LLM7: bakiyesiz/iptal edilmiş anahtar). */
  keyOptional?: boolean;
}

/** DeepSeek akışsız yanıtlarda araç çağrısı ayraçlarını (`<｜tool▁calls▁begin｜>…`) içeriğe de yazar; düz metinde istenmez. */
export function stripToolMarkup(text: string): string {
  return text.replace(/<[｜|]+tool▁calls▁begin[｜|]+>[\s\S]*?(?:<[｜|]+tool▁calls▁end[｜|]+>|$)/g, '').trim();
}

/** Zaman aşımı hatası (bağlanma ya da akış arası sessizlik): yeniden denenebilir sayılır. */
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

function createEndpoint(profile: Profile, config: Config, log: Logger, fetchImpl: typeof fetch): AiProvider {
  const gate = new Semaphore(config.AI_MAX_CONCURRENCY);

  let keyBlockedUntil = 0;
  let cooldownUntil = 0;
  const KEY_RETRY_MS = 10 * 60_000;

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (profile.apiKey && Date.now() >= keyBlockedUntil) h.authorization = `Bearer ${profile.apiKey}`;
    return h;
  }

  function body(req: AiRequest, stream: boolean) {
    return JSON.stringify({
      model: profile.model,
      messages: req.messages,
      stream,
      temperature: req.temperature ?? 0.7,
      ...(profile.sendEffort ? { reasoning_effort: (config.AI_MAX_EFFORT && profile.maxEffort) || req.effort || 'medium' } : {}),
      max_tokens: req.maxTokens ?? config.AI_MAX_TOKENS,
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
  async function open(req: AiRequest, stream: boolean): Promise<{ res: Response; ctl: AbortController; timer: ReturnType<typeof setTimeout> }> {
    let throttled = 0;
    let failed = 0;
    let lastStatus = 0;
    for (;;) {
      if (Date.now() < cooldownUntil) throw new HttpError(503, 'upstream_busy', 'Yapay zekâ servisi şu an yoğun. Birkaç saniye sonra tekrar dene.');
      await pace(req.signal);
      // Süre yalnızca bağlanma/ilk yanıt için geçerlidir; akış başladıktan sonra boşta kalma süresiyle (stream) denetlenir.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(timeoutError()), config.AI_TIMEOUT_MS);
      const signal = req.signal ? AbortSignal.any([req.signal, ctl.signal]) : ctl.signal;
      let res: Response | undefined;
      try {
        res = await fetchImpl(profile.baseUrl, {
          method: 'POST',
          headers: headers(),
          body: body(req, stream),
          signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (req.signal?.aborted) throw err;
      }
      if (res?.ok) return { res, ctl, timer };
      clearTimeout(timer);

      let delay: number | undefined;
      if (res) {
        lastStatus = res.status;
        const retryAfter = Number(res.headers.get('retry-after'));
        const snippet = (await res.text().catch(() => '')).slice(0, 300);
        // Anahtar reddedildi ya da anahtarın kotası doldu: bir süre anahtarsız denenir (ayrı kota olabilir).
        if (profile.keyOptional && profile.apiKey && Date.now() >= keyBlockedUntil && ([401, 402, 403].includes(res.status) || (res.status === 429 && /quota/i.test(snippet)))) {
          keyBlockedUntil = Date.now() + KEY_RETRY_MS;
          log.warn({ status: res.status, body: snippet }, 'anahtar kullanılamadı, anahtarsız deneniyor');
          continue;
        }
        // Uzun süre (≥ 1 dk) beklemesi istenen uç, o süre boyunca (en çok 10 dk) denenmez: zincir hemen yedeğe geçer.
        if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter >= 60) cooldownUntil = Date.now() + Math.min(retryAfter, 600) * 1_000;
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
      const { res, ctl, timer } = await open(req, true);
      clearTimeout(timer);
      if (!res.body) throw new HttpError(502, 'upstream_unavailable', 'Boş yanıt alındı.');
      // Bekçiler: akış arası sessizlik ve mutlak üst süre. Süre dolarsa gövde okuması hata fırlatır.
      let idle = setTimeout(() => ctl.abort(timeoutError()), config.AI_IDLE_TIMEOUT_MS);
      const total = setTimeout(() => ctl.abort(timeoutError()), config.AI_TOTAL_TIMEOUT_MS);
      const touch = () => {
        clearTimeout(idle);
        idle = setTimeout(() => ctl.abort(timeoutError()), config.AI_IDLE_TIMEOUT_MS);
      };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const calls = new Map<number, AiToolCall>();
      let sawContent = false;
      let truncated = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
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
            if (json.choices?.[0]?.finish_reason === 'length') truncated = true;
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
            .filter((c) => c.function.name)
            // Bazı modeller (GLM) aynı çağrıyı birden çok kez üretir: birebir aynı olanlar tek sayılır.
            .filter((c, i, all) => all.findIndex((o) => o.function.name === c.function.name && o.function.arguments === c.function.arguments) === i);
          if (list.length) yield { type: 'tool_calls', calls: list };
        }
        if (truncated) yield { type: 'truncated' };
      } catch (err) {
        // Süre aşımı: kullanıcıya anlaşılır bir hata; kendi iptalimiz (kullanıcı durdurdu) olduğu gibi geçer.
        if (!req.signal?.aborted && (err as Error)?.name === 'TimeoutError') {
          throw new HttpError(502, 'upstream_unavailable', 'Yapay zekâ servisi uzun süre yanıt vermedi, yanıt yarıda kaldı.');
        }
        throw err;
      } finally {
        clearTimeout(idle);
        clearTimeout(total);
        reader.cancel().catch(() => {});
      }
    } finally {
      release();
    }
  }

  async function complete(req: AiRequest): Promise<string> {
    const release = await gate.acquire(req.signal, 25_000);
    try {
      const { res, timer } = await open(req, false);
      let json: any;
      try {
        json = await res.json();
      } finally {
        clearTimeout(timer);
      }
      const content = json?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? stripToolMarkup(content) : '';
    } finally {
      release();
    }
  }

  return { stream, complete };
}

/**
 * Çalışma moduna göre sağlayıcı sırası seçer (güç ve hız sıralamasına göre; bkz. `chain`). Seçilen sağlayıcı yanıt vermeye başlamadan
 * başarısız olursa (200 dışı yanıt, hız sınırı, kesinti, boş yanıt) sıradakine düşülür. Code'un zinciri ayrıdır: Qwen → Claude.
 */
export function createAi(
  config: Config,
  log: Logger = { warn: () => {} },
  fetchImpl: typeof fetch = fetch,
  bedrockImpl?: AiProvider,
  now: () => number = Date.now,
): AiProvider {
  const fast = createEndpoint({ baseUrl: config.AI_BASE_URL, model: config.AI_MODEL, apiKey: config.AI_API_KEY, sendEffort: true, maxEffort: 'high' }, config, log, fetchImpl);
  const make = (baseUrl: string, model: string, apiKey: string, sendEffort: boolean, maxEffort?: 'high' | 'max') =>
    baseUrl ? createEndpoint({ baseUrl, model, apiKey, sendEffort, maxEffort }, config, log, fetchImpl) : undefined;
  // gpt-oss `reasoning_effort` ister; Qwen3.8 bununla boş yanıt döner.
  const balanced = make(config.AI_BALANCED_BASE_URL, config.AI_BALANCED_MODEL, config.AI_BALANCED_API_KEY, true, 'high');
  const deep = make(config.AI_DEEP_BASE_URL, config.AI_DEEP_MODEL, config.AI_DEEP_API_KEY, false);
  // Ücretsiz sağlayıcılar: DeepSeek (LLM7) → GLM (LLM7) → MiniMax (Kilo). Her biri `reasoning_effort`'u kabul eder.
  const free: Array<{ name: string; ai: AiProvider }> = [];
  if (config.AI_FREE_ENABLED) {
    const llm7 = (model: string) => (config.LLM7_BASE_URL && model ? createEndpoint({ baseUrl: config.LLM7_BASE_URL, model, apiKey: config.LLM7_API_KEY, sendEffort: true, maxEffort: 'max', keyOptional: true }, config, log, fetchImpl) : undefined);
    const d = llm7(config.LLM7_MODEL);
    const g = llm7(config.LLM7_MODEL_2);
    const k = make(config.KILO_BASE_URL, config.KILO_MODEL, config.KILO_API_KEY, true, 'max');
    if (d) free.push({ name: 'deepseek', ai: d });
    if (g) free.push({ name: 'glm', ai: g });
    if (k) free.push({ name: 'minimax', ai: k });
  }
  const backup = bedrockImpl ?? (bedrockConfigured(config) ? createBedrock(config) : undefined);

  /** Code'da Claude yedeğinin tüm kullanıcılar için günlük token tavanı (Bedrock harcamasını korur). */
  const claude = { day: '', used: 0 };
  const claudeToday = () => {
    const d = new Date(now()).toISOString().slice(0, 10);
    if (claude.day !== d) Object.assign(claude, { day: d, used: 0 });
    return claude;
  };
  const approxTokens = (req: AiRequest) => Math.ceil(req.messages.reduce((n, m) => n + m.content.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0) / 3.5);

  /** Bu mod için denenecek sağlayıcılar, sırayla (yapılandırılmamış olanlar atlanır). */
  const chain = (mode: ChatMode | undefined, route?: 'code'): Array<{ name: string; ai: AiProvider }> => {
    // Code: seçilen modele göre sıra (Hızlı/Derin); ücretsiz modeller kapalıysa Qwen, olmazsa Claude. Hızlı (Pollinations) modeline ASLA düşülmez: kod ajanında sessizce zayıf modele geçmek kötü sonuç verir.
    if (route === 'code') {
      // Kullanıcının seçtiği model: Hızlı = hız öncelikli (MiniMax önde), Derin = güç öncelikli (DeepSeek > GLM > Qwen > Claude).
      // Ücretsiz üçüncü taraf modeller yalnızca `AI_FREE_FOR_CODE` açıksa girer; kapalıyken ikisi de Qwen → Claude'dur.
      const codeOrder = mode === 'fast' ? ['minimax', 'deepseek', 'glm', 'qwen', 'claude'] : ['deepseek', 'glm', 'qwen', 'claude'];
      const codePool: Record<string, { name: string; ai: AiProvider } | undefined> = {
        minimax: config.AI_FREE_FOR_CODE ? free.find((f) => f.name === 'minimax') : undefined,
        deepseek: config.AI_FREE_FOR_CODE ? free.find((f) => f.name === 'deepseek') : undefined,
        glm: config.AI_FREE_FOR_CODE ? free.find((f) => f.name === 'glm') : undefined,
        qwen: deep && { name: 'qwen', ai: deep },
        claude: backup && { name: 'claude', ai: backup },
      };
      return codeOrder.map((k) => codePool[k]).filter(Boolean) as Array<{ name: string; ai: AiProvider }>;
    }
    // Güç: DeepSeek > GLM > Qwen > MiniMax = Claude > gpt-oss-120b > gpt-oss-20b (Pollinations). Hız: DeepSeek > MiniMax > diğerleri eşit.
    // Hızlı: başta MiniMax (hızlı ve ücretsiz), ardından hız sırası. Dengeli: gpt-oss-120b → MiniMax → GLM, sonra kalanlar. Derin: güç sırası. Ücretsizler ücretli Claude'dan önce gelir.
    const pool: Record<string, { name: string; ai: AiProvider } | undefined> = {
      deepseek: free.find((f) => f.name === 'deepseek'),
      glm: free.find((f) => f.name === 'glm'),
      minimax: free.find((f) => f.name === 'minimax'),
      qwen: deep && { name: 'deep', ai: deep },
      claude: backup && { name: 'bedrock', ai: backup },
      gptoss120: balanced && { name: 'balanced', ai: balanced },
      gptoss20: { name: 'fast', ai: fast },
    };
    const ORDER: Record<ChatMode, string[]> = {
      fast: ['minimax', 'deepseek', 'glm', 'qwen', 'gptoss120', 'gptoss20', 'claude'],
      balanced: ['gptoss120', 'minimax', 'glm', 'deepseek', 'qwen', 'claude', 'gptoss20'],
      deep: ['deepseek', 'glm', 'qwen', 'minimax', 'claude', 'gptoss120', 'gptoss20'],
    };
    return ORDER[mode ?? 'fast'].map((k) => pool[k]).filter(Boolean) as Array<{ name: string; ai: AiProvider }>;
  };
  const aborted = (req: AiRequest, err: unknown) => req.signal?.aborted || (err as Error)?.name === 'AbortError';

  return {
    async *stream(req) {
      const list = chain(req.mode, req.route);
      if (!list.length) throw new HttpError(503, 'upstream_unavailable', 'Code için model yapılandırılmamış (AI_DEEP_BASE_URL).');
      for (const [i, p] of list.entries()) {
        const last = i === list.length - 1;
        let started = false;
        // Claude yedeği: günlük genel token tavanı dolduysa denenmez.
        if (req.route === 'code' && p.name === 'claude') {
          const c = claudeToday();
          if (config.CODE_CLAUDE_DAILY_TOKENS <= 0 || c.used >= config.CODE_CLAUDE_DAILY_TOKENS) {
            if (last) throw new HttpError(503, 'upstream_busy', 'Code modeli şu an yoğun, yedek model de bugünlük doldu. Biraz sonra tekrar dene.');
            continue;
          }
        }
        let produced = 0;
        try {
          for await (const chunk of p.ai.stream(last ? req : { ...req, failFast: true })) {
            if (!started) req.onProvider?.(p.name);
            started = true;
            if (chunk.type === 'content' || chunk.type === 'reasoning') produced += chunk.text.length;
            else if (chunk.type === 'tool_calls') produced += JSON.stringify(chunk.calls).length;
            yield chunk;
          }
          if (started && req.route === 'code' && p.name === 'claude') claudeToday().used += approxTokens(req) + Math.ceil(produced / 3.5);
          if (started) return;
          if (last) return;
          log.warn({ mode: req.mode, provider: p.name }, 'sağlayıcı boş yanıt verdi, yedeğe düşülüyor');
        } catch (err) {
          if (started && req.route === 'code' && p.name === 'claude') claudeToday().used += approxTokens(req) + Math.ceil(produced / 3.5);
          if (started || last || aborted(req, err)) throw err;
          log.warn({ mode: req.mode, provider: p.name, err: String(err) }, 'sağlayıcı yanıt vermedi, yedeğe düşülüyor');
        }
      }
    },
    async complete(req) {
      const list = chain(req.mode, req.route);
      if (!list.length) throw new HttpError(503, 'upstream_unavailable', 'Code için model yapılandırılmamış (AI_DEEP_BASE_URL).');
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
