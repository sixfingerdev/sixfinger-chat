import * as cheerio from 'cheerio';
import { ToolError } from './errors.ts';
import { Gate, TtlCache } from './limits.ts';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  locale: 'tr' | 'en';
  limit: number;
  signal?: AbortSignal;
}

export interface SearchOutcome {
  provider: string;
  results: SearchResult[];
}

type Fetcher = typeof fetch;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// ---------- DuckDuckGo ----------
function ddgUrl(href: string): string | null {
  try {
    const u = new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com');
    const target = u.hostname.endsWith('duckduckgo.com') && u.pathname.startsWith('/l/') ? u.searchParams.get('uddg') : u.toString();
    if (!target) return null;
    const t = new URL(target);
    return t.protocol === 'http:' || t.protocol === 'https:' ? t.toString() : null;
  } catch {
    return null;
  }
}

/** html.duckduckgo.com sonuç sayfası. */
export function parseDdgHtml(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $('.result').each((_, el) => {
    const node = $(el);
    if (node.hasClass('result--ad')) return;
    const a = node.find('a.result__a').first();
    const url = ddgUrl(a.attr('href') ?? '');
    const title = clean(a.text());
    if (!url || !title) return;
    out.push({ title, url, snippet: clean(node.find('.result__snippet').first().text()) });
  });
  return out;
}

/** lite.duckduckgo.com: tablo düzeni. */
export function parseDdgLite(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $('a.result-link').each((_, el) => {
    const a = $(el);
    const url = ddgUrl(a.attr('href') ?? '');
    const title = clean(a.text());
    if (!url || !title) return;
    const snippet = clean(a.closest('tr').nextAll('tr').find('td.result-snippet').first().text());
    out.push({ title, url, snippet });
  });
  return out;
}

function isDdgBlocked(status: number, body: string): boolean {
  return status === 202 || status === 403 || status === 429 || /anomaly|unusual traffic|are you a human/i.test(body.slice(0, 20_000));
}

// ---------- Bing (yedek) ----------
function bingUrl(href: string): string | null {
  try {
    const u = new URL(href, 'https://www.bing.com');
    if (!u.hostname.endsWith('bing.com')) return u.toString();
    // bing.com/ck/a?...&u=a1<base64url(hedef)>
    const enc = u.searchParams.get('u');
    if (!enc) return null;
    const b64 = enc.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
    const target = Buffer.from(b64, 'base64').toString('utf8');
    const t = new URL(target);
    return t.protocol === 'http:' || t.protocol === 'https:' ? t.toString() : null;
  } catch {
    return null;
  }
}

export function parseBing(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $('li.b_algo').each((_, el) => {
    const node = $(el);
    const a = node.find('h2 a').first();
    const url = bingUrl(a.attr('href') ?? '');
    const title = clean(a.text());
    if (!url || !title) return;
    const snippet = clean(node.find('.b_caption p, p.b_lineclamp2, p.b_lineclamp3, p').first().text());
    out.push({ title, url, snippet });
  });
  return out;
}

// ---------- Birleşik arama ----------
export interface Searcher {
  search(query: string, opts: SearchOptions): Promise<SearchOutcome>;
}

export function createSearcher(fetchImpl: Fetcher = fetch, now: () => number = Date.now): Searcher {
  const cache = new TtlCache<SearchOutcome>(10 * 60_000, 300);
  const gate = new Gate(3);
  let lastDdg = 0;
  const DDG_GAP_MS = 1_200;

  async function get(url: string, init: RequestInit, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(10_000);
    const res = await fetchImpl(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'follow' });
    return { status: res.status, body: await res.text() };
  }

  const form = (q: string, locale: 'tr' | 'en') =>
    new URLSearchParams({ q, kl: locale === 'tr' ? 'tr-tr' : 'us-en', b: '' }).toString();
  const ddgHeaders = (locale: 'tr' | 'en', host: string) => ({
    'user-agent': UA,
    'content-type': 'application/x-www-form-urlencoded',
    'accept-language': locale === 'tr' ? 'tr-TR,tr;q=0.9,en;q=0.7' : 'en-US,en;q=0.9',
    origin: `https://${host}`,
    referer: `https://${host}/`,
  });

  const providers: Array<{
    name: string;
    run: (q: string, o: SearchOptions) => Promise<SearchResult[]>;
  }> = [
    {
      name: 'DuckDuckGo',
      async run(q, o) {
        const wait = lastDdg + DDG_GAP_MS - now();
        lastDdg = Math.max(now(), lastDdg + DDG_GAP_MS);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const r = await get('https://html.duckduckgo.com/html/', { method: 'POST', headers: ddgHeaders(o.locale, 'html.duckduckgo.com'), body: form(q, o.locale) }, o.signal);
        if (isDdgBlocked(r.status, r.body)) throw new Error('ddg-blocked');
        return parseDdgHtml(r.body);
      },
    },
    {
      name: 'DuckDuckGo Lite',
      async run(q, o) {
        const r = await get('https://lite.duckduckgo.com/lite/', { method: 'POST', headers: ddgHeaders(o.locale, 'lite.duckduckgo.com'), body: form(q, o.locale) }, o.signal);
        if (isDdgBlocked(r.status, r.body)) throw new Error('ddg-lite-blocked');
        return parseDdgLite(r.body);
      },
    },
    {
      name: 'Bing',
      async run(q, o) {
        const params = new URLSearchParams({ q, setlang: o.locale, cc: o.locale === 'tr' ? 'TR' : 'US', count: '10' });
        const r = await get(`https://www.bing.com/search?${params}`, { headers: { 'user-agent': UA, 'accept-language': o.locale === 'tr' ? 'tr-TR,tr;q=0.9' : 'en-US,en;q=0.9' } }, o.signal);
        if (r.status !== 200) throw new Error(`bing-${r.status}`);
        return parseBing(r.body);
      },
    },
  ];

  return {
    async search(query, opts) {
      const q = query.trim();
      const key = `${opts.locale}:${q.toLowerCase()}`;
      const hit = cache.get(key, now());
      if (hit) return { ...hit, results: hit.results.slice(0, opts.limit) };

      return gate.run(async () => {
        for (const p of providers) {
          if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          try {
            const results = (await p.run(q, opts)).slice(0, 10);
            if (results.length) {
              const outcome = { provider: p.name, results };
              cache.set(key, outcome, now());
              return { ...outcome, results: results.slice(0, opts.limit) };
            }
          } catch (err) {
            if (opts.signal?.aborted) throw err;
            // sıradaki sağlayıcıya geç
          }
        }
        throw new ToolError('Arama servisleri şu an yanıt vermiyor. Biraz sonra tekrar dene ya da başka bir ifade dene.');
      });
    },
  };
}
