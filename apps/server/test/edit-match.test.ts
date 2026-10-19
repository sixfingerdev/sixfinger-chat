import { describe, expect, it } from 'vitest';
import { applyEdit, didYouMean, lineDiffStats, normalizeTypographic } from '../src/services/tools/edit-match.ts';

const ok = (r: ReturnType<typeof applyEdit>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('applyEdit', () => {
  const file = 'function topla(a, b) {\n  return a + b;\n}\n\nconsole.log(topla(1, 2));\n';

  it('birebir eşleşmeyi değiştirir ve satır numarasını verir', () => {
    const r = ok(applyEdit(file, '  return a + b;', '  return Number(a) + Number(b);'));
    expect(r.content).toBe('function topla(a, b) {\n  return Number(a) + Number(b);\n}\n\nconsole.log(topla(1, 2));\n');
    expect(r).toMatchObject({ replacements: 1, strategy: 'exact', line: 2 });
  });

  it('birden çok eşleşmede hata verir, replace_all ile hepsini değiştirir', () => {
    const f = 'x = 1\ny = 2\nx = 1\n';
    const e = applyEdit(f, 'x = 1', 'x = 9');
    expect(e.ok).toBe(false);
    expect(!e.ok && e.error).toMatch(/Found 2 matches/);
    expect(!e.ok && e.error).toMatch(/replace_all/);
    expect(ok(applyEdit(f, 'x = 1', 'x = 9', true))).toMatchObject({ content: 'x = 9\ny = 2\nx = 9\n', replacements: 2 });
  });

  it('boş old_string ve aynı metin reddedilir', () => {
    expect(applyEdit(file, '', 'a')).toMatchObject({ ok: false });
    const same = applyEdit(file, 'return', 'return');
    expect(!same.ok && same.error).toMatch(/identical/);
  });

  it('tipografik tırnak/tire/özel boşluk farklarını tolere eder', () => {
    const f = 'const s = “merhaba”;\nconst d = a – b;\nconst n = x + y;\n';
    expect(ok(applyEdit(f, 'const s = "merhaba";', 'const s = "selam";'))).toMatchObject({ strategy: 'normalized', content: expect.stringContaining('const s = "selam";') });
    expect(ok(applyEdit(f, 'const d = a - b;', 'const d = a + b;')).content).toContain('const d = a + b;');
    expect(ok(applyEdit(f, 'const n = x + y;', 'const n = 0;')).content).toContain('const n = 0;');
  });

  it('satır sonu boşluklarını yok sayar (satır eşleşmesi) ve komşu satırlara dokunmaz', () => {
    const f = 'a = 1;   \nb = 2;\t\nc = 3;\n';
    const r = ok(applyEdit(f, 'a = 1;\nb = 2;', 'a = 10;\nb = 20;'));
    expect(r.strategy).toBe('trimmed');
    expect(r.content).toBe('a = 10;\nb = 20;\nc = 3;\n');
    // sondaki satır sonu olan old/new
    const r2 = ok(applyEdit(f, 'a = 1;\nb = 2;\n', 'a = 10;\nb = 20;\n'));
    expect(r2.content).toBe('a = 10;\nb = 20;\nc = 3;\n');
  });

  it('girinti farkı TOLERE EDİLMEZ (sessiz bulanık yazma yok) ama benzer satır önerilir', () => {
    const e = applyEdit(file, 'return a + b;', 'return 0;'); // girinti yok → birebir alt dize olarak eşleşir
    expect(e.ok).toBe(true); // alt dize eşleşmesi doğru ve benzersiz
    const miss = applyEdit(file, '    return a  + b;', 'return 0;');
    expect(miss.ok).toBe(false);
    expect(!miss.ok && miss.error).toMatch(/closest text in the file/);
    expect(!miss.ok && miss.error).toMatch(/2:   return a \+ b;/);
  });

  it('olmayan metinde benzer satır yoksa öneri eklemez', () => {
    const e = applyEdit(file, 'tamamen alakasız bir metin parçası', 'x');
    expect(!e.ok && e.error).not.toMatch(/closest/);
  });

  it('new_string zaten dosyadaysa ipucu verir', () => {
    const e = applyEdit(file, 'return x * y;', 'console.log(topla(1, 2));');
    expect(!e.ok && e.error).toMatch(/already appears/);
  });

  it('CRLF ve BOM korunur', () => {
    const f = '﻿a\r\nb\r\nc\r\n';
    const r = ok(applyEdit(f, 'b', 'B1\nB2'));
    expect(r.content).toBe('﻿a\r\nB1\r\nB2\r\nc\r\n');
  });

  it('özel regex karakterli metinde güvenli', () => {
    const f = 'x = a.b(c)*[d]$e\n';
    expect(ok(applyEdit(f, 'a.b(c)*[d]$e', 'z')).content).toBe('x = z\n');
  });
});

describe('didYouMean', () => {
  it('bağlamla en benzer satırı gösterir', () => {
    const out = didYouMean('l1\nl2\nconst veri = yukle("a.json");\nl4\n', 'const veri = yukle(“a.json”)  ;');
    expect(out).toContain('3: const veri = yukle("a.json");');
  });
});

describe('normalizeTypographic', () => {
  it('uzunluğu korur', () => {
    const s = '“a” ‘b’ – —  ';
    expect(normalizeTypographic(s)).toHaveLength(s.length);
  });
});

describe('lineDiffStats', () => {
  it.each([
    ['a\nb\nc\n', 'a\nb\nc\n', 0, 0],
    ['', 'a\nb\n', 2, 0],
    ['a\nb\n', '', 0, 2],
    ['a\nb\nc\n', 'a\nX\nc\n', 1, 1],
    ['a\nb\nc\n', 'a\nb\nc\nd\ne\n', 2, 0],
    ['1\n2\n3\n4\n5\n', '1\n3\n5\n', 0, 2],
    ['a\nb\nc\nd\n', 'b\nc\nx\ny\n', 2, 2],
    ['const a = 1;\nconsole.log(a);\n', 'const a = 2;\nconsole.log(a);\nconsole.log("yeni");\n', 2, 1],
  ])('%j → +%i −%i', (a, b, add, del) => expect(lineDiffStats(a as string, b as string)).toEqual({ additions: add, deletions: del }));

  it('büyük dosyada hızlı', () => {
    const a = Array.from({ length: 20_000 }, (_, i) => `satır ${i}`);
    const b = [...a];
    b[10_000] = 'değişti';
    b.splice(5_000, 0, 'eklenen');
    const t = Date.now();
    expect(lineDiffStats(a.join('\n'), b.join('\n'))).toEqual({ additions: 2, deletions: 1 });
    expect(Date.now() - t).toBeLessThan(500);
  });
});
