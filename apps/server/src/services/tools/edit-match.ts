/**
 * Code `edit` aracının eşleştirmesi (saf fonksiyonlar). opencode (MIT) ve aider (Apache-2.0) derslerine göre:
 *  1) birebir  2) tipografik tırnak/tire/özel boşluk normalizasyonu  3) satır sonu boşluklarını yok sayan satır eşleşmesi.
 * Bulanık eşleştirmeyle sessizce yazılmaz; eşleşmezse modele dosyadaki en benzer gerçek satırlar gösterilir.
 */

export type Strategy = 'exact' | 'normalized' | 'trimmed';

export type EditOutcome =
  | { ok: true; content: string; replacements: number; strategy: Strategy; line: number }
  | { ok: false; error: string };

/** Her karakteri tek karakterle değiştirir: indeksler değişmez, eşleşme konumları doğrudan kullanılabilir. */
export function normalizeTypographic(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

function indicesOf(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

interface Span {
  start: number;
  end: number;
}

/** Satır sonu boşluklarını yok sayarak `needle` satırlarını ardışık satırlarda arar. Tüm satırları kapsayan aralıkları döndürür. */
function trimmedLineSpans(content: string, needle: string): Span[] {
  const want = needle.split('\n').map((l) => l.trimEnd());
  if (want.length && want[want.length - 1] === '') want.pop();
  if (!want.length || want.every((l) => l === '')) return [];
  const lines = content.split('\n');
  const offsets: number[] = [];
  let at = 0;
  for (const l of lines) {
    offsets.push(at);
    at += l.length + 1;
  }
  const spans: Span[] = [];
  for (let i = 0; i + want.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) {
      if (lines[i + j]!.trimEnd() !== want[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const last = i + want.length - 1;
      spans.push({ start: offsets[i]!, end: offsets[last]! + lines[last]!.length });
      i += want.length - 1;
    }
  }
  return spans;
}

/** İki satırın benzerliği (0..1): ortak karakter ikilileri (Dice). */
function similarity(a: string, b: string): number {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) grams.set(x.slice(i, i + 2), (grams.get(x.slice(i, i + 2)) ?? 0) + 1);
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      hits++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hits) / (x.length + y.length - 2);
}

/** Eşleşmeyen `old` için dosyadaki en benzer gerçek satırları (±3 satır bağlamla) gösterir. */
export function didYouMean(content: string, old: string): string {
  const lines = content.split('\n');
  const probe = old.split('\n').find((l) => l.trim().length > 3) ?? old.split('\n')[0] ?? '';
  let best = -1;
  let score = 0;
  for (let i = 0; i < lines.length; i++) {
    const s = similarity(probe, lines[i]!);
    if (s > score) {
      score = s;
      best = i;
    }
  }
  if (best < 0 || score < 0.6) return '';
  const from = Math.max(0, best - 3);
  const to = Math.min(lines.length, best + 4);
  const shown = lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1}: ${l}`)
    .join('\n');
  return `\nThe closest text in the file (lines ${from + 1}-${to}):\n${shown}\nCopy the exact text (whitespace and indentation included) from the file.`;
}

export function applyEdit(raw: string, oldString: string, newString: string, replaceAll = false): EditOutcome {
  if (oldString === '') return { ok: false, error: 'old_string must not be empty. To create a file or replace its whole content use the write tool.' };
  if (oldString === newString) return { ok: false, error: 'No changes to apply: old_string and new_string are identical.' };

  // BOM ve satır sonu (CRLF) korunur; eşleşme LF görünümünde yapılır.
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  let text = bom ? raw.slice(1) : raw;
  const crlf = text.includes('\r\n');
  if (crlf) text = text.replace(/\r\n/g, '\n');
  const oldS = oldString.replace(/\r\n/g, '\n');
  const newS = newString.replace(/\r\n/g, '\n');
  const done = (content: string, replacements: number, strategy: Strategy, firstIndex: number): EditOutcome => ({
    ok: true,
    content: bom + (crlf ? content.replace(/\n/g, '\r\n') : content),
    replacements,
    strategy,
    line: lineOf(content, firstIndex),
  });

  const tooMany = (n: number): EditOutcome => ({
    ok: false,
    error: `Found ${n} matches for old_string. Add more surrounding context so it matches exactly one place, or set replace_all to true to change all of them.`,
  });

  // 1) birebir
  const exact = indicesOf(text, oldS);
  if (exact.length === 1 || (exact.length > 1 && replaceAll)) {
    const out = replaceAll ? text.split(oldS).join(newS) : text.slice(0, exact[0]!) + newS + text.slice(exact[0]! + oldS.length);
    return done(out, exact.length, 'exact', exact[0]!);
  }
  if (exact.length > 1) return tooMany(exact.length);

  // 2) tipografik normalizasyon (indeksler korunur)
  const nText = normalizeTypographic(text);
  const nOld = normalizeTypographic(oldS);
  const norm = nOld === oldS && nText === text ? [] : indicesOf(nText, nOld);
  if (norm.length === 1 || (norm.length > 1 && replaceAll)) {
    let out = text;
    for (const i of [...(replaceAll ? norm : [norm[0]!])].reverse()) out = out.slice(0, i) + newS + out.slice(i + oldS.length);
    return done(out, replaceAll ? norm.length : 1, 'normalized', norm[0]!);
  }
  if (norm.length > 1) return tooMany(norm.length);

  // 3) satır sonu boşluklarını yok say
  const spans = trimmedLineSpans(text, oldS);
  if (spans.length === 1 || (spans.length > 1 && replaceAll)) {
    // Eşleşen aralık satır sonunu içermez; yeni metin de sondaki satır sonunu taşımamalı.
    const repl = oldS.endsWith('\n') && newS.endsWith('\n') ? newS.slice(0, -1) : newS;
    let out = text;
    for (const sp of [...(replaceAll ? spans : [spans[0]!])].reverse()) out = out.slice(0, sp.start) + repl + out.slice(sp.end);
    return done(out, replaceAll ? spans.length : 1, 'trimmed', spans[0]!.start);
  }
  if (spans.length > 1) return tooMany(spans.length);

  const already = newS.length > 3 && text.includes(newS) ? '\nNote: new_string already appears in the file, so this edit may have been applied already. Read the file to check.' : '';
  return {
    ok: false,
    error: `Could not find old_string in the file. It must match the file exactly, including whitespace and indentation.${already}${didYouMean(text, oldS)}`,
  };
}

/** Satır farkı (Myers, O(ND)) ile eklenen/silinen satır sayısı. Çok büyük farklarda satır sayısı farkına düşer. */
export function lineDiffStats(oldText: string, newText: string): { additions: number; deletions: number } {
  if (oldText === newText) return { additions: 0, deletions: 0 };
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  if (a.at(-1) === '' && oldText.endsWith('\n')) a.pop();
  if (b.at(-1) === '' && newText.endsWith('\n')) b.pop();
  // ortak baş ve sonu at
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const x = a.slice(s, ea);
  const y = b.slice(s, eb);
  const n = x.length;
  const m = y.length;
  if (!n || !m) return { additions: m, deletions: n };
  const max = Math.min(n + m, 4_000);
  const v = new Int32Array(2 * max + 2);
  const off = max;
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) {
        i++;
        j++;
      }
      v[off + k] = i;
      if (i >= n && j >= m) {
        // d = ekle + sil; ortak (n - sil) = (m - ekle) ⇒ sil = (d + n - m) / 2
        const deletions = (d + n - m) / 2;
        return { additions: d - deletions, deletions };
      }
    }
  }
  return { additions: m, deletions: n };
}
