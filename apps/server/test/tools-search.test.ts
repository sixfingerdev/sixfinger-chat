import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSearcher, fuseResults, parseBing, parseDdgHtml, parseDdgLite, parseSearxng } from '../src/services/tools/search.ts';

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
  it('DuckDuckGo engellenirse (202) Lite denenir; ikisi de engelliyse yalnızca Bing sonucu kullanılır', async () => {
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
    expect(a.provider).toBe('DuckDuckGo'); // Bing yanıt vermedi: tek motorla sürer
    expect(a.results).toHaveLength(1);
    const b = await s.search('raspberry pi', { locale: 'en', limit: 5 });
    expect(b.results).toHaveLength(2);
    expect(calls).toHaveLength(2); // DuckDuckGo + Bing birlikte sorulur; ikinci arama önbellekten (yeni istek yok)
  });

  it('hepsi başarısızsa anlaşılır hata verir', async () => {
    const { f } = fakeFetch({});
    const s = createSearcher(f);
    await expect(s.search('x y', { locale: 'tr', limit: 3 })).rejects.toThrow(/Arama servisleri/);
  });
});

describe('SearXNG ve sıralama birleştirme', () => {
  const searx = {
    infoboxes: [{ infobox: 'Hatay', content: 'Hatay, Türkiye\'nin güneyinde bir ildir.', id: 'https://tr.wikipedia.org/wiki/Hatay' }],
    results: [
      { title: 'Hatay - Vikipedi', url: 'https://tr.wikipedia.org/wiki/Hatay/', content: 'Uzun ve ayrıntılı bir Hatay açıklaması metni burada.' },
      { title: 'Hatay Valiliği', url: 'https://www.hatay.gov.tr/', content: 'Resmî site.' },
      { title: 'tehlikeli', url: 'javascript:alert(1)', content: 'x' },
      { title: 'Hatay Valiliği (tekrar)', url: 'https://hatay.gov.tr', content: 'Daha uzun bir özet metni ile aynı sayfa.' },
    ],
  };

  it('parseSearxng: bilgi kutusu başa gelir, tehlikeli şema atılır, aynı sayfa tekrarlanmaz', () => {
    const r = parseSearxng(searx);
    expect(r.map((x) => x.url)).toEqual(['https://tr.wikipedia.org/wiki/Hatay', 'https://www.hatay.gov.tr/']);
    expect(r[0]!.title).toBe('Hatay'); // bilgi kutusunun başlığı kalır, aynı sayfanın daha uzun özeti alınır
    expect(r[0]!.snippet).toContain('ayrıntılı');
    expect(r[1]!.snippet).toBe('Daha uzun bir özet metni ile aynı sayfa.'); // yinelenenin uzun özeti korunur
  });

  it('fuseResults: iki motorun da üst sıraya koyduğu sayfa öne çıkar, tekrarlar birleşir', () => {
    const a = [{ title: 'A', url: 'https://a.com/', snippet: '' }, { title: 'X', url: 'https://x.com', snippet: '' }, { title: 'B', url: 'https://www.b.com/p?utm_source=z', snippet: 'özet' }];
    const b = [{ title: 'B', url: 'https://b.com/p', snippet: 'daha uzun özet' }, { title: 'C', url: 'https://c.com', snippet: '' }, { title: 'A', url: 'https://www.a.com', snippet: '' }];
    const f = fuseResults([a, b]);
    expect(f.map((x) => x.title)).toEqual(['A', 'B', 'X', 'C']);
    expect(f.find((x) => x.title === 'B')!.snippet).toBe('daha uzun özet');
  });

  it('SearXNG ayarlıysa önce o sorulur (dil ve biçim parametreleri); çalışmazsa DuckDuckGo + Bing, ve bir dakika boyunca tekrar denenmez', async () => {
    let t = 0;
    const down = fakeFetch({
      'searxng:8080': () => new Response('x', { status: 500 }),
      'html.duckduckgo.com': () => new Response(fx('ddg.html'), { status: 200 }),
      'bing.com': () => new Response(fx('bing.html'), { status: 200 }),
    });
    const s = createSearcher(down.f, () => (t += 1_000), { searxngUrl: 'http://searxng:8080' });
    const out = await s.search('hatay nüfusu', { locale: 'tr', limit: 10 });
    expect(out.provider).toBe('DuckDuckGo + Bing');
    expect(down.calls[0]).toMatch(/^http:\/\/searxng:8080\/search\?.*format=json/);
    expect(down.calls[0]).toContain('language=tr-TR');
    const searxCalls = () => down.calls.filter((c) => c.includes('searxng')).length;
    expect(searxCalls()).toBe(1);
    await s.search('başka sorgu', { locale: 'tr', limit: 10 });
    expect(searxCalls()).toBe(1); // 60 sn dolmadan SearXNG'ye yeniden gidilmedi

    const ok = fakeFetch({ 'searxng:8080': () => new Response(JSON.stringify(searx), { status: 200 }) });
    const s2 = createSearcher(ok.f, () => 0, { searxngUrl: 'http://searxng:8080/' });
    const r2 = await s2.search('hatay', { locale: 'en', limit: 3 });
    expect(r2.provider).toBe('SearXNG');
    expect(r2.results.map((x) => x.title)).toEqual(['Hatay', 'Hatay Valiliği']);
    expect(ok.calls).toHaveLength(1);
  });
});
