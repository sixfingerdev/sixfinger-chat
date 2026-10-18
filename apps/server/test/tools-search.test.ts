import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSearcher, parseBing, parseDdgHtml, parseDdgLite } from '../src/services/tools/search.ts';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

describe('arama sonucu ayrıştırıcıları', () => {
  it('DuckDuckGo HTML: reklamı ve tehlikeli şemayı atar, yönlendirmeyi çözer', () => {
    const r = parseDdgHtml(fx('ddg.html'));
    expect(r.map((x) => x.url)).toEqual(['https://www.raspberrypi.com/products/raspberry-pi-4-model-b/', 'https://docs.docker.com/engine/install/']);
    expect(r[0]!.title).toBe('Raspberry Pi 4 Model B');
    expect(r[0]!.snippet).toContain('robot');
  });

  it('DuckDuckGo Lite', () => {
    const r = parseDdgLite(fx('ddg-lite.html'));
    expect(r).toEqual([{ title: 'Örnek Başlık', url: 'https://example.org/a', snippet: 'Kısa bir özet metni.' }]);
  });

  it('Bing: izleme bağlantısındaki hedefi çözer, reklamı atar', () => {
    const r = parseBing(fx('bing.html'));
    expect(r.map((x) => x.url)).toEqual(['https://tr.wikipedia.org/wiki/Hatay', 'https://example.com/direct']);
    expect(r[0]!.snippet).toContain('güneyinde');
  });
});

function fakeFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    for (const [k, h] of Object.entries(handlers)) if (url.includes(k)) return h(init);
    throw new Error('beklenmeyen istek');
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('birleşik arama', () => {
  it('DuckDuckGo engellenirse (202) sırayla Lite ve Bing\'e düşer', async () => {
    const { f, calls } = fakeFetch({
      'html.duckduckgo.com': () => new Response('anomaly', { status: 202 }),
      'lite.duckduckgo.com': () => new Response('anomaly', { status: 202 }),
      'bing.com': () => new Response(fx('bing.html'), { status: 200 }),
    });
    let t = 0;
    const s = createSearcher(f, () => (t += 5_000));
    const out = await s.search('hatay', { locale: 'tr', limit: 5 });
    expect(out.provider).toBe('Bing');
    expect(out.results).toHaveLength(2);
    expect(calls).toHaveLength(3);
  });

  it('DuckDuckGo çalışıyorsa onu kullanır ve sonucu önbellekler', async () => {
    const { f, calls } = fakeFetch({ 'html.duckduckgo.com': () => new Response(fx('ddg.html'), { status: 200 }) });
    let t = 0;
    const s = createSearcher(f, () => (t += 5_000));
    const a = await s.search('Raspberry Pi', { locale: 'en', limit: 1 });
    expect(a.provider).toBe('DuckDuckGo');
    expect(a.results).toHaveLength(1);
    const b = await s.search('raspberry pi', { locale: 'en', limit: 5 });
    expect(b.results).toHaveLength(2);
    expect(calls).toHaveLength(1); // ikincisi önbellekten
  });

  it('hepsi başarısızsa anlaşılır hata verir', async () => {
    const { f } = fakeFetch({});
    const s = createSearcher(f);
    await expect(s.search('x y', { locale: 'tr', limit: 3 })).rejects.toThrow(/Arama servisleri/);
  });
});
