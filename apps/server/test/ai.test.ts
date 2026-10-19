import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { createAi, stripToolMarkup } from '../src/services/ai.ts';

const config = loadConfig();
/** Yalnızca Pollinations (Hızlı) yapılandırılmış: uç nokta davranışı testleri için. */
const solo = { ...config, AI_DEEP_BASE_URL: '', AI_BALANCED_BASE_URL: '' };
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
    const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
    const out: Array<[string, string]> = [];
    for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }] })) if (c.type === 'reasoning' || c.type === 'content') out.push([c.type, c.text]);
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
    const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
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
    const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
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
    const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
    let text = '';
    for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }], mode: 'fast', effort: 'low' })) if (c.type === 'content') text += c.text;
    expect(text).toBe('tamam');
    expect(calls).toBe(2);
  });

  it('kalıcı 4xx hatasında yeniden denemeden hata verir', async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls++;
      return new Response('{}', { status: 400 });
    };
    const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
    await expect(ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'fast', effort: 'low' })).rejects.toMatchObject({
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
    const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
    expect(await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'fast', effort: 'low' })).toBe('ok');
    expect(sent).toMatchObject({ model: 'openai-fast', stream: false, reasoning_effort: 'high' });
  });

  it('iptal sinyali beklemeyi keser', async () => {
    const fetchMock = async () => new Response('{}', { status: 402 });
    const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await expect(
      (async () => {
        for await (const _ of ai.stream({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal })) void _;
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('moda göre sağlayıcı (ücretsizler kapalı)', () => {
    const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    const run = async (mode: 'fast' | 'balanced' | 'deep', handler: (url: string, body: any) => Response) => {
      const calls: Array<{ url: string; body: any }> = [];
      const fetchMock = async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url, body });
        return handler(url, body);
      };
      const ai = createAi(config, undefined, fetchMock as unknown as typeof fetch);
      const text = await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode, effort: 'medium' });
      return { calls, text };
    };

    it('güç sırası: Qwen önde, sonra gpt-oss-120b, en sonda gpt-oss-20b; Qwen\'e düşünme düzeyi gitmez, gpt-oss\'a high gider', async () => {
      const first = await run('deep', ok);
      expect(first.calls).toHaveLength(1);
      expect(first.calls[0]!.body.model).toBe('Qwen3.8-27B');
      expect(first.calls[0]!.body).not.toHaveProperty('reasoning_effort');
      const all = await run('deep', (url) => (url === config.AI_BASE_URL ? ok() : new Response('{}', { status: 400 })));
      expect(all.calls.map((c) => c.body.model)).toEqual(['Qwen3.8-27B', 'gpt-oss-120b', 'openai-fast']);
      expect(all.calls[1]!.body.reasoning_effort).toBe('high');
      expect(all.calls[2]!.body.reasoning_effort).toBe('high');
    });

    it('AI_BALANCED_BASE_URL boşsa Dengeli o adımı atlar', async () => {
      const calls: string[] = [];
      const ai = createAi({ ...config, AI_BALANCED_BASE_URL: '' }, undefined, (async (_u: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)).model);
        return new Response('{}', { status: 400 });
      }) as unknown as typeof fetch);
      await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'balanced' }).catch(() => '');
      expect(calls).toEqual(['Qwen3.8-27B', 'openai-fast']);
    });
  });

  describe('ücretsiz sağlayıcılar (LLM7 + Kilo)', () => {
    const cfg = { ...config, AI_FREE_ENABLED: true, LLM7_API_KEY: 'k-test' };
    const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    const run = async (mode: 'fast' | 'balanced' | 'deep', handler: (url: string, body: any, auth: string | undefined) => Response, c = cfg) => {
      const calls: Array<{ url: string; model: string; auth?: string }> = [];
      const fetchMock = async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const auth = (init.headers as Record<string, string>).authorization;
        calls.push({ url, model: body.model, auth });
        return handler(url, body, auth);
      };
      const ai = createAi(c, undefined, fetchMock as unknown as typeof fetch);
      const text = await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode, effort: 'medium' });
      return { calls, text };
    };
    const llm7 = cfg.LLM7_BASE_URL;

    it('hız sırası (fast): DeepSeek (anahtarla) → MiniMax → GLM → Qwen → gpt-oss-120b → gpt-oss-20b', async () => {
      const first = await run('fast', ok);
      expect(first.calls).toEqual([{ url: llm7, model: 'DeepSeek-V4-Flash-0731', auth: 'Bearer k-test' }]);
      const r = await run('fast', (url) => (url === llm7 ? new Response('{}', { status: 400 }) : ok()));
      expect(r.calls.map((c) => c.model)).toEqual(['DeepSeek-V4-Flash-0731', 'minimax/minimax-m3.1-flash:free']);
      const all = await run('fast', (url) => (url === config.AI_BASE_URL ? ok() : new Response('{}', { status: 400 })));
      expect(all.calls.map((c) => c.model)).toEqual(['DeepSeek-V4-Flash-0731', 'minimax/minimax-m3.1-flash:free', 'GLM-5.3-Flash', 'Qwen3.8-27B', 'gpt-oss-120b', 'openai-fast']);
    });

    it('LLM7 anahtarı reddedilirse (402) aynı istek anahtarsız yeniden denenir ve bir süre anahtar kullanılmaz', async () => {
      let n = 0;
      const calls: Array<string | undefined> = [];
      const fetchMock = async (_u: string, init: RequestInit) => {
        const auth = (init.headers as Record<string, string>).authorization;
        calls.push(auth);
        return auth && n++ === 0 ? new Response('{"error":"balance"}', { status: 402 }) : ok();
      };
      const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch);
      const req = { messages: [{ role: 'user' as const, content: 'x' }], mode: 'fast' as const };
      expect(await ai.complete(req)).toBe('ok');
      expect(await ai.complete(req)).toBe('ok');
      expect(calls).toEqual(['Bearer k-test', undefined, undefined]);
    });

    it('kota dolduğunda (429 + uzun retry-after) anahtarsız dener; o da dolarsa uç bir süre atlanır', async () => {
      const calls: Array<string | undefined> = [];
      const fetchMock = async (_u: string, init: RequestInit) => {
        calls.push((init.headers as Record<string, string>).authorization);
        return new Response('{"error":{"message":"Daily token quota exceeded","type":"insufficient_quota"}}', { status: 429, headers: { 'retry-after': '3600' } });
      };
      const only = { ...cfg, KILO_BASE_URL: '', LLM7_MODEL_2: '', AI_BASE_URL: 'https://p.example/x', AI_BALANCED_BASE_URL: '', AI_DEEP_BASE_URL: '' };
      const ai = createAi(only, undefined, fetchMock as unknown as typeof fetch);
      const req = { messages: [{ role: 'user' as const, content: 'x' }], mode: 'fast' as const, failFast: true };
      await expect(ai.complete(req)).rejects.toMatchObject({ status: 503 });
      expect(calls.slice(0, 2)).toEqual(['Bearer k-test', undefined]);
      const before = calls.length;
      await expect(ai.complete(req)).rejects.toMatchObject({ status: 503 });
      // LLM7 artık denenmez (bekleme süresi), yalnızca son sağlayıcıya gidilir.
      expect(calls.length - before).toBeLessThanOrEqual(2);
    });

    it('güç sırası (deep): DeepSeek → GLM → Qwen → MiniMax → gpt-oss-120b → gpt-oss-20b; balanced: DeepSeek → GLM → MiniMax → Qwen …', async () => {
      const failAll = (url: string) => (url === config.AI_BASE_URL ? ok() : new Response('{}', { status: 400 }));
      const deep = await run('deep', failAll);
      expect(deep.calls.map((c) => c.model)).toEqual(['DeepSeek-V4-Flash-0731', 'GLM-5.3-Flash', 'Qwen3.8-27B', 'minimax/minimax-m3.1-flash:free', 'gpt-oss-120b', 'openai-fast']);
      const mid = await run('balanced', failAll);
      expect(mid.calls.map((c) => c.model)).toEqual(['DeepSeek-V4-Flash-0731', 'GLM-5.3-Flash', 'minimax/minimax-m3.1-flash:free', 'Qwen3.8-27B', 'gpt-oss-120b', 'openai-fast']);
    });

    it('Code: varsayılan Qwen→(Claude); AI_FREE_FOR_CODE açıkken Qwen→DeepSeek→GLM (MiniMax yok)', async () => {
      const code = async (c: typeof cfg) => {
        const models: string[] = [];
        const fetchMock = async (_u: string, init: RequestInit) => {
          models.push(JSON.parse(String(init.body)).model);
          return new Response('{}', { status: 400 });
        };
        const ai = createAi(c, undefined, fetchMock as unknown as typeof fetch);
        await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'deep', route: 'code' }).catch(() => '');
        return models;
      };
      expect(await code(cfg)).toEqual(['Qwen3.8-27B']);
      expect(await code({ ...cfg, AI_FREE_FOR_CODE: true })).toEqual(['Qwen3.8-27B', 'DeepSeek-V4-Flash-0731', 'GLM-5.3-Flash']);
    });

    it('reasoning_effort: ücretsiz modellere max, gpt-oss\'a high gider; AI_MAX_EFFORT kapalıysa kullanıcı düzeyi', async () => {
      const efforts: Record<string, string> = {};
      const fetchMock = async (_u: string, init: RequestInit) => {
        const b = JSON.parse(String(init.body));
        efforts[b.model] = b.reasoning_effort;
        return new Response('{}', { status: 400 });
      };
      const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch);
      await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'fast', effort: 'low' }).catch(() => '');
      expect(efforts).toEqual({ 'DeepSeek-V4-Flash-0731': 'max', 'GLM-5.3-Flash': 'max', 'minimax/minimax-m3.1-flash:free': 'max', 'Qwen3.8-27B': undefined, 'gpt-oss-120b': 'high', 'openai-fast': 'high' });
      const user: Record<string, string> = {};
      const ai2 = createAi({ ...cfg, AI_MAX_EFFORT: false }, undefined, (async (_u: string, init: RequestInit) => {
        const b = JSON.parse(String(init.body));
        user[b.model] = b.reasoning_effort;
        return new Response('{}', { status: 400 });
      }) as unknown as typeof fetch);
      await ai2.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'fast', effort: 'low' }).catch(() => '');
      expect(Object.entries(user).filter(([m]) => m !== 'Qwen3.8-27B').every(([, v]) => v === 'low')).toBe(true);
    });

    it('AI_FREE_ENABLED kapalıyken zincire girmez', async () => {
      const r = await run('fast', (url) => (url === config.AI_BASE_URL ? ok() : new Response('{}', { status: 400 })), { ...cfg, AI_FREE_ENABLED: false });
      expect(r.calls.map((c) => c.model)).toEqual(['Qwen3.8-27B', 'gpt-oss-120b', 'openai-fast']);
    });

    it('aynı araç çağrısını tekrar eden modelde (GLM) tek çağrı kalır; DeepSeek ayraçları düz metinden silinir', async () => {
      const tc = (i: number, id: string, args: string) => delta({ tool_calls: [{ index: i, id, type: 'function', function: { name: 'get', arguments: args } }] });
      const fetchMock = async () => sse([tc(0, 'a', '{"c":"x"}'), tc(1, 'b', '{"c":"x"}'), tc(2, 'c', '{"c":"y"}')]);
      const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch);
      const calls = [];
      for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }], mode: 'fast' })) if (c.type === 'tool_calls') calls.push(...c.calls);
      expect(calls.map((c) => c.id)).toEqual(['a', 'c']);
      expect(stripToolMarkup('Merhaba<｜｜tool▁calls▁begin｜｜><｜｜tool▁call▁begin｜｜>get<｜｜tool▁sep｜｜>{}<｜｜tool▁call▁end｜｜><｜｜tool▁calls▁end｜｜>')).toBe('Merhaba');
    });
  });

  describe('zaman aşımı', () => {
    /** Gövdesi `chunks` kadar parçayı `gapMs` arayla gönderen, iptal sinyaline uyan sahte yanıt. */
    const slow = (signal: AbortSignal | null | undefined, chunks: string[], gapMs: number, hang = false) =>
      new Response(
        new ReadableStream({
          async start(c) {
            signal?.addEventListener('abort', () => c.error(signal.reason), { once: true });
            const enc = new TextEncoder();
            for (const ch of chunks) {
              await new Promise((r) => setTimeout(r, gapMs));
              c.enqueue(enc.encode(`data: ${JSON.stringify(delta({ content: ch }))}\n\n`));
            }
            if (!hang) {
              c.enqueue(enc.encode('data: [DONE]\n\n'));
              c.close();
            }
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );

    it('toplam süre bağlanma süresini aşan ama akmaya devam eden yanıtı kesmez', async () => {
      const cfg = { ...solo, AI_TIMEOUT_MS: 80 };
      const fetchMock = async (_u: string, init: RequestInit) => slow(init.signal, Array.from({ length: 12 }, (_, i) => `p${i} `), 25);
      const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch);
      let text = '';
      for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }], mode: 'fast' })) if (c.type === 'content') text += c.text;
      expect(text).toContain('p11');
    });

    it('akış arası sessizlik uzun sürerse anlaşılır bir hatayla kesilir', async () => {
      const cfg = { ...solo, AI_IDLE_TIMEOUT_MS: 150 };
      const fetchMock = async (_u: string, init: RequestInit) => slow(init.signal, ['bir'], 10, true);
      const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch);
      const got: string[] = [];
      await expect(
        (async () => {
          for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }], mode: 'fast' })) if (c.type === 'content') got.push(c.text);
        })(),
      ).rejects.toMatchObject({ code: 'upstream_unavailable', message: expect.stringContaining('yarıda kaldı') });
      expect(got).toEqual(['bir']);
    });

    it('istekte yüksek bir max_tokens gönderilir', async () => {
      let sent: any;
      const fetchMock = async (_u: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
      };
      const ai = createAi(solo, undefined, fetchMock as unknown as typeof fetch);
      await ai.complete({ messages: [{ role: 'user', content: 'x' }], mode: 'fast' });
      expect(sent.max_tokens).toBe(config.AI_MAX_TOKENS);
      expect(config.AI_MAX_TOKENS).toBeGreaterThanOrEqual(16_000);
    });
  });
});

describe('Code zinciri (Qwen → Claude)', () => {
  const failing = async () => new Response('limit', { status: 429 });
  const bedrock = (text: string) => ({
    async *stream() {
      yield { type: 'content' as const, text };
    },
    async complete() {
      return text;
    },
  });
  const run = async (ai: ReturnType<typeof createAi>, onProvider?: (n: string) => void) => {
    let out = '';
    for await (const c of ai.stream({ messages: [{ role: 'user', content: 'x' }], route: 'code', onProvider, failFast: true })) if (c.type === 'content') out += c.text;
    return out;
  };

  it('Qwen yanıtlarsa yalnızca Qwen uç noktası çağrılır (Hızlı sağlayıcıya dokunulmaz)', async () => {
    const urls: string[] = [];
    const fetchMock = async (u: string) => {
      urls.push(String(u));
      return sse([delta({ content: 'qwen yanıtı' })]);
    };
    const cfg = loadConfig();
    const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch, bedrock('claude yanıtı'));
    const seen: string[] = [];
    expect(await run(ai, (n) => seen.push(n))).toBe('qwen yanıtı');
    expect(seen).toEqual(['qwen']);
    expect(urls).toEqual([cfg.AI_DEEP_BASE_URL]);
  });

  it('Qwen hata verirse Claude yedeği devreye girer; Hızlı sağlayıcıya ASLA düşülmez', async () => {
    const urls: string[] = [];
    const fetchMock = async (u: string) => {
      urls.push(String(u));
      return failing();
    };
    const cfg = loadConfig();
    const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch, bedrock('claude yanıtı'));
    const seen: string[] = [];
    expect(await run(ai, (n) => seen.push(n))).toBe('claude yanıtı');
    expect(seen).toEqual(['claude']);
    expect(urls.every((u) => u === cfg.AI_DEEP_BASE_URL)).toBe(true);
    // yedek yoksa hata verir (Hızlı'ya düşmez)
    const noBackup = createAi({ ...cfg, BEDROCK_MODEL_ID: '' }, undefined, fetchMock as unknown as typeof fetch);
    await expect(run(noBackup)).rejects.toBeTruthy();
    expect(urls.every((u) => u === cfg.AI_DEEP_BASE_URL)).toBe(true);
  });

  it('Claude yedeği günlük genel token tavanına uyar; gün değişince sıfırlanır', async () => {
    const fetchMock = async () => failing();
    const cfg = { ...loadConfig(), CODE_CLAUDE_DAILY_TOKENS: 50 };
    let t = Date.parse('2026-10-19T10:00:00Z');
    const big = { messages: [{ role: 'user' as const, content: 'x'.repeat(700) }], route: 'code' as const };
    const ai = createAi(cfg, undefined, fetchMock as unknown as typeof fetch, bedrock('claude'), () => t);
    const once = async () => {
      let out = '';
      for await (const c of ai.stream(big)) if (c.type === 'content') out += c.text;
      return out;
    };
    expect(await once()).toBe('claude'); // ~200 token harcar → tavan (50) aşıldı
    await expect(once()).rejects.toMatchObject({ code: 'upstream_busy' });
    t += 86_400_000; // ertesi gün
    expect(await once()).toBe('claude');
    // tavan 0 = yedek kapalı
    const off = createAi({ ...cfg, CODE_CLAUDE_DAILY_TOKENS: 0 }, undefined, fetchMock as unknown as typeof fetch, bedrock('claude'));
    await expect(run(off)).rejects.toMatchObject({ code: 'upstream_busy' });
  });

  it('complete() de Code zincirini kullanır', async () => {
    const cfg = loadConfig();
    const ai = createAi(cfg, undefined, (async () => failing()) as unknown as typeof fetch, bedrock('commit mesajı'));
    expect(await ai.complete({ messages: [{ role: 'user', content: 'x' }], route: 'code' })).toBe('commit mesajı');
  });
});
