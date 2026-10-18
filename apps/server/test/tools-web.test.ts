import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/lib/types.ts';
import { TIER_LIMITS } from '@sixfinger/shared';
import { runToolCall, createTools } from '../src/services/tools/index.ts';
import { createWebSearchTool, extractReadable, extractStructured } from '../src/services/tools/web.ts';
import type { Searcher } from '../src/services/tools/search.ts';

const user = (tier: 'guest' | 'unverified' | 'member' = 'member'): AuthUser => ({
  id: 'u1', email: null, isGuest: tier === 'guest', emailVerified: tier === 'member', tier, limits: TIER_LIMITS[tier], locale: 'tr', sessionId: 's',
});
const ctx = (tier: 'guest' | 'unverified' | 'member' = 'member') => ({ user: user(tier), signal: new AbortController().signal });

describe('extractReadable', () => {
  it('ana içeriği çıkarır, script/nav gürültüsünü atar', () => {
    const html = `<html><head><title>Test Sayfası</title></head><body>
      <nav>Menü Menü Menü</nav>
      <article><h1>Büyük Başlık</h1><p>${'Bu bir deneme paragrafıdır. '.repeat(20)}</p><ul><li>bir</li><li>iki</li></ul>
      <pre><code>const x = 1;</code></pre></article>
      <script>alert(1)</script><footer>Telif</footer></body></html>`;
    const { title, markdown } = extractReadable(html, 'https://example.com/a');
    expect(title).toContain('Test');
    expect(markdown).toContain('deneme paragrafıdır');
    expect(markdown).toContain('const x = 1;');
    expect(markdown).not.toContain('alert(1)');
  });
});

describe('araç çalıştırma', () => {
  const tools = createTools();

  it('katmana göre araç listesi: misafir de web araçlarını görür', () => {
    expect(tools.forUser(user('guest')).map((t) => t.name).sort()).toEqual(['web_fetch', 'web_search']);
  });

  it('bilinmeyen araç ve bozuk JSON hata olarak döner, fırlatmaz', async () => {
    const defs = tools.forUser(user());
    const a = await runToolCall(defs, { id: '1', type: 'function', function: { name: 'rm_rf', arguments: '{}' } }, ctx());
    expect(a.status).toBe('error');
    expect(a.output).toMatch(/yok/);
    const b = await runToolCall(defs, { id: '2', type: 'function', function: { name: 'web_fetch', arguments: '{bozuk' } }, ctx());
    expect(b.status).toBe('error');
    expect(b.output).toMatch(/JSON/);
  });

  it('web_fetch iç adresleri reddeder', async () => {
    const defs = tools.forUser(user());
    const r = await runToolCall(defs, { id: '3', type: 'function', function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }) } }, ctx());
    expect(r.status).toBe('error');
    expect(r.output).toMatch(/engellendi/);
  });

  it('web_search sonucu biçimler ve hız sınırı uygular', async () => {
    const searcher: Searcher = {
      async search(q) {
        return { provider: 'Test', results: [{ title: `T ${q}`, url: 'https://a.com', snippet: 's' }] };
      },
    };
    const def = createWebSearchTool(searcher);
    const call = (q: string) => runToolCall([def], { id: 'x', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: q }) } }, ctx());
    const ok = await call('deneme');
    expect(ok.status).toBe('done');
    expect(ok.output).toContain('1. T deneme');
    expect(ok.summary).toBe('1 sonuç');
    for (let i = 0; i < 7; i++) await call('deneme');
    const limited = await call('deneme');
    expect(limited.status).toBe('error');
    expect(limited.output).toMatch(/sık/);
  });
});

describe('yapılandırılmış veri (JSON-LD)', () => {
  const page = (ld: object) => `<html><head><title>Mağaza</title>
    <script type="application/ld+json">${JSON.stringify(ld)}</script></head>
    <body><div>${'Ürün açıklaması metni. '.repeat(15)}</div></body></html>`;

  it('Product + Offer: fiyat ve stok çıkarılır (Readability atsa bile)', () => {
    const { structured } = extractReadable(
      page({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Product', name: 'Raspberry Pi 5 - 8GB', brand: { '@type': 'Brand', name: 'Raspberry Pi' }, sku: 'RPI5-8GB',
            offers: { '@type': 'Offer', price: '3499.00', priceCurrency: 'TRY', availability: 'https://schema.org/InStock' },
            aggregateRating: { ratingValue: '4.8', reviewCount: '12' },
          },
        ],
      }),
      'https://shop.example/p',
    );
    expect(structured).toHaveLength(1);
    expect(structured[0]).toContain('Raspberry Pi 5 - 8GB');
    expect(structured[0]).toContain('fiyat 3499.00 TRY');
    expect(structured[0]).toContain('durum InStock');
    expect(structured[0]).toContain('puan 4.8/5 (12 yorum)');
  });

  it('Makale ve bozuk JSON-LD', () => {
    expect(extractStructured(['{bozuk', JSON.stringify({ '@type': 'NewsArticle', headline: 'Başlık', datePublished: '2026-10-01T10:00:00Z', author: { name: 'Ayşe' } })])).toEqual([
      'Makale: Başlık | yazar Ayşe | yayın 2026-10-01',
    ]);
  });
});
