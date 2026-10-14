import { describe, expect, it } from 'vitest';
import { normalizeMath } from './markdown-prep.ts';

describe('normalizeMath', () => {
  it('blok ve satır içi LaTeX ayırıcılarını dönüştürür', () => {
    expect(normalizeMath('a \\(x^2\\) b')).toBe('a $x^2$ b');
    expect(normalizeMath('\\[ E=mc^2 \\]')).toContain('$$\nE=mc^2\n$$');
  });
  it('kod bloklarına ve satır içi koda dokunmaz', () => {
    const code = '```js\nconst s = "\\\\(x\\\\)";\n```';
    expect(normalizeMath(code)).toBe(code);
    expect(normalizeMath('`\\(x\\)` ve \\(y\\)')).toBe('`\\(x\\)` ve $y$');
  });
  it('tamamlanmamış (akıştaki) kod bloğunu bozmaz', () => {
    const open = 'metin\n```py\nprint("\\(")';
    expect(normalizeMath(open)).toBe(open);
  });
});
