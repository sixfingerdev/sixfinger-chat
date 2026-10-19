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

// ---------- SearXNG (kendi sunucunda çalışan meta arama; anahtar gerektirmez) ----------
interface SearxJson {
  results?: Array<{ title?: string; url?: string; content?: string; engines?: string[] }>;
  infoboxes?: Array<{ infobox?: string; content?: string; id?: string; urls?: Array<{ title?: string; url?: string }> }>;
}

/** SearXNG `format=json` yanıtı: sonuçlar (SearXNG'nin kendi birleşik sıralamasıyla) + varsa bilgi kutusu (Vikipedi gibi) en başta. */
export function parseSearxng(json: SearxJson): SearchResult[] {
  const out: SearchResult[] = [];
  const box = json.infoboxes?.[0];
  const boxUrl = box?.id && /^https?:\/\//.test(box.id) ? box.id : box?.urls?.find((u) => u.url && /^https?:\/\//.test(u.url))?.url;
  if (box?.infobox && box.content && boxUrl) out.push({ title: clean(box.infobox), url: boxUrl, snippet: clean(box.content).slice(0, 500) });
  for (const r of json.results ?? []) {
    const url = r.url ?? '';
    const title = clean(r.title);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    out.push({ title, url, snippet: clean(r.content).slice(0, 400) });
  }
  return dedupe(out);
}

// ---------- Sıralama birleştirme ----------
/** Aynı sayfanın farklı yazımlarını eşler (şema, www, sondaki eğik çizgi, izleme parametreleri yok sayılır). */
function canonical(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}

function dedupe(list: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const r of list) {
    const k = canonical(r.url);
    const cur = seen.get(k);
    if (!cur) seen.set(k, r);
    else if (r.snippet.length > cur.snippet.length) cur.snippet = r.snippet;
  }
  return [...seen.values()];
}

/** Reciprocal Rank Fusion: iki motorun da üst sıraya koyduğu sayfa öne çıkar; tek motordaki sonuçlar sırasını korur. */
export function fuseResults(lists: SearchResult[][]): SearchResult[] {
  const scores = new Map<string, { r: SearchResult; score: number }>();
  for (const list of lists) {
    list.forEach((r, i) => {
      const k = canonical(r.url);
      const add = 1 / (60 + i);
      const cur = scores.get(k);
      if (cur) {
        cur.score += add;
        if (r.snippet.length > cur.r.snippet.length) cur.r = { ...cur.r, snippet: r.snippet };
      } else scores.set(k, { r, score: add });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).map((x) => x.r);
}

// ---------- Birleşik arama ----------
export interface Searcher {
  search(query: string, opts: SearchOptions): Promise<SearchOutcome>;
}

export interface SearcherOptions {
  /** Kendi sunucundaki SearXNG adresi (ör. http://searxng:8080). Verilirse ilk o denenir; boşsa DuckDuckGo + Bing birlikte sıralanır. */
  searxngUrl?: string;
}

export function createSearcher(fetchImpl: Fetcher = fetch, now: () => number = Date.now, options: SearcherOptions = {}): Searcher {
  const cache = new TtlCache<SearchOutcome>(10 * 60_000, 300);
  const gate = new Gate(3);
  let lastDdg = 0;
  const DDG_GAP_MS = 1_200;

  async function get(url: string, init: RequestInit, signal?: AbortSignal, ms = 10_000) {
    const timeout = AbortSignal.timeout(ms);
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

  async function ddg(q: string, o: SearchOptions): Promise<SearchResult[]> {
    const wait = lastDdg + DDG_GAP_MS - now();
    lastDdg = Math.max(now(), lastDdg + DDG_GAP_MS);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await get('https://html.duckduckgo.com/html/', { method: 'POST', headers: ddgHeaders(o.locale, 'html.duckduckgo.com'), body: form(q, o.locale) }, o.signal);
    if (!isDdgBlocked(r.status, r.body)) {
      const res = parseDdgHtml(r.body);
      if (res.length) return res;
    }
    // html uç noktası engellendi ya da boş: Lite sürümü
    const l = await get('https://lite.duckduckgo.com/lite/', { method: 'POST', headers: ddgHeaders(o.locale, 'lite.duckduckgo.com'), body: form(q, o.locale) }, o.signal);
    if (isDdgBlocked(l.status, l.body)) throw new Error('ddg-blocked');
    return parseDdgLite(l.body);
  }

  async function bing(q: string, o: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q, setlang: o.locale, cc: o.locale === 'tr' ? 'TR' : 'US', count: '10' });
    const r = await get(`https://www.bing.com/search?${params}`, { headers: { 'user-agent': UA, 'accept-language': o.locale === 'tr' ? 'tr-TR,tr;q=0.9' : 'en-US,en;q=0.9' } }, o.signal);
    if (r.status !== 200) throw new Error(`bing-${r.status}`);
    return parseBing(r.body);
  }

  // SearXNG kapalıysa her aramada 12 sn beklenmesin: bir dakika boyunca doğrudan yedeğe geçilir.
  let searxDownUntil = 0;
  async function searx(q: string, o: SearchOptions): Promise<SearchResult[]> {
    if (now() < searxDownUntil) throw new Error('searxng-down');
    try {
      return await searxQuery(q, o);
    } catch (err) {
      if (!o.signal?.aborted) searxDownUntil = now() + 60_000;
      throw err;
    }
  }
  async function searxQuery(q: string, o: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q, format: 'json', language: o.locale === 'tr' ? 'tr-TR' : 'en-US', safesearch: '0', categories: 'general' });
    const r = await get(`${options.searxngUrl!.replace(/\/$/, '')}/search?${params}`, { headers: { accept: 'application/json', 'user-agent': UA } }, o.signal, 12_000);
    if (r.status !== 200) throw new Error(`searxng-${r.status}`);
    return parseSearxng(JSON.parse(r.body) as SearxJson);
  }

  const providers: Array<{
    name: string;
    run: (q: string, o: SearchOptions) => Promise<{ name?: string; results: SearchResult[] }>;
  }> = [
    ...(options.searxngUrl ? [{ name: 'SearXNG', run: async (q: string, o: SearchOptions) => ({ results: await searx(q, o) }) }] : []),
    {
      // Yedek: iki motor birlikte sorulur ve sıralamaları birleştirilir (tek motorun kötü sıralamasına bağımlı kalınmaz).
      name: 'DuckDuckGo + Bing',
      async run(q, o) {
        const [d, b] = await Promise.allSettled([ddg(q, o), bing(q, o)]);
        const lists: Array<[string, SearchResult[]]> = [];
        if (d.status === 'fulfilled' && d.value.length) lists.push(['DuckDuckGo', d.value]);
        if (b.status === 'fulfilled' && b.value.length) lists.push(['Bing', b.value]);
        if (!lists.length) throw new Error('no-results');
        return { name: lists.map((l) => l[0]).join(' + '), results: fuseResults(lists.map((l) => l[1])) };
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
            const ran = await p.run(q, opts);
            const results = ran.results.slice(0, 10);
            if (results.length) {
              const outcome = { provider: ran.name ?? p.name, results };
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
