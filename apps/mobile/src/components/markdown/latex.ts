/**
 * Hafif LaTeX → Unicode dönüştürücü. WebView/KaTeX olmadan sık kullanılan ifadeleri (Yunan harfleri,
 * üs/alt simge, kesir, kök, operatörler) okunur düz metne çevirir. Karmaşık yapılar (matris, hizalama)
 * çözülemezse LaTeX kaynağı olduğu gibi kalır.
 */
const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•', oplus: '⊕', otimes: '⊗',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄', emptyset: '∅',
  varnothing: '∅', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩',
  setminus: '∖', land: '∧', wedge: '∧', lor: '∨', vee: '∨', lnot: '¬', neg: '¬', Rightarrow: '⇒', Leftarrow: '⇐',
  Leftrightarrow: '⇔', rightarrow: '→', to: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', mapsto: '↦', implies: '⟹',
  iff: '⟺', uparrow: '↑', downarrow: '↓', sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', angle: '∠', perp: '⊥', parallel: '∥', degree: '°', prime: '′',
  hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', therefore: '∴', because: '∵', langle: '⟨', rangle: '⟩',
  lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', quad: '  ', qquad: '    ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
  lbrace: '{', rbrace: '}', '{': '{', '}': '}', '%': '%', '&': '&', '#': '#', _: '_', '$': '$',
};

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'gcd', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'mod', 'Pr']);

const BLACKBOARD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼', H: 'ℍ' };

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼',
  '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', k: 'ᵏ', m: 'ᵐ', t: 'ᵗ', T: 'ᵀ',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌',
  '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', m: 'ₘ', o: 'ₒ', x: 'ₓ', t: 'ₜ', p: 'ₚ', r: 'ᵣ', s: 'ₛ',
};

function mapScript(body: string, table: Record<string, string>, fallbackPrefix: string): string {
  const chars = [...body];
  const mapped = chars.filter((ch) => table[ch] !== undefined).length;
  // Çoğu karakter simge karşılığına sahipse eşleşenleri çevir, kalanları (ör. virgül) olduğu gibi bırak.
  if (mapped > 0 && mapped >= chars.length / 2) return chars.map((ch) => table[ch] ?? ch).join('');
  return `${fallbackPrefix}${chars.length > 1 ? `(${body})` : body}`;
}

/** `{...}` bloğunu bulur: `src[start]` '{' olmalı. [içerik, bitişten sonraki indeks] döner. */
function readGroup(src: string, start: number): [string, number] {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return [src.slice(start + 1, i), i + 1];
  }
  return [src.slice(start + 1), src.length];
}

/** Bir argümanı okur: `{...}`, `\komut` ya da tek karakter. */
function readArg(src: string, i: number): [string, number] {
  while (src[i] === ' ') i++;
  if (src[i] === '{') return readGroup(src, i);
  if (src[i] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
    if (m) return [m[0], i + m[0].length];
  }
  return [src[i] ?? '', i + 1];
}

export function latexToText(input: string): string {
  const src = input.trim();
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1]!;
      i += m[0].length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [a, j] = readArg(src, i);
        const [b, k] = readArg(src, j);
        i = k;
        const num = latexToText(a);
        const den = latexToText(b);
        const wrap = (s: string) => (/^[\w.]+$/.test(s) ? s : `(${s})`);
        out += `${wrap(num)}/${wrap(den)}`;
      } else if (name === 'sqrt') {
        let root = '';
        if (src[i] === '[') {
          const end = src.indexOf(']', i);
          root = src.slice(i + 1, end);
          i = end + 1;
        }
        const [a, j] = readArg(src, i);
        i = j;
        const inner = latexToText(a);
        const sign = root === '3' ? '∛' : root === '4' ? '∜' : '√';
        out += /^[\w.]+$/.test(inner) ? `${sign}${inner}` : `${sign}(${inner})`;
      } else if (name === 'text' || name === 'mathrm' || name === 'textbf' || name === 'mathbf' || name === 'operatorname' || name === 'mathit' || name === 'boldsymbol' || name === 'mathcal' || name === 'mathsf') {
        const [a, j] = readArg(src, i);
        i = j;
        out += latexToText(a);
      } else if (name === 'mathbb') {
        const [a, j] = readArg(src, i);
        i = j;
        out += BLACKBOARD[a] ?? a;
      } else if (name === 'vec' || name === 'overrightarrow') {
        const [a, j] = readArg(src, i);
        i = j;
        out += `${latexToText(a)}⃗`;
      } else if (name === 'hat' || name === 'widehat') {
        const [a, j] = readArg(src, i);
        i = j;
        out += `${latexToText(a)}̂`;
      } else if (name === 'bar' || name === 'overline') {
        const [a, j] = readArg(src, i);
        i = j;
        out += `${latexToText(a)}̄`;
      } else if (name === 'dot') {
        const [a, j] = readArg(src, i);
        i = j;
        out += `${latexToText(a)}̇`;
      } else if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'bigg' || name === 'Bigg' || name === 'displaystyle' || name === 'limits' || name === 'nolimits') {
        if (name === 'left' || name === 'right') {
          if (src[i] === '.') i++;
        }
      } else if (name === 'begin' || name === 'end') {
        const [env, j] = readArg(src, i);
        i = j;
        if (name === 'begin' && /matrix|cases|array|aligned|align/.test(env)) out += '\n';
      } else if (name === '\\') {
        out += '\n';
      } else if (FUNCTIONS.has(name)) {
        out += name;
        if (src[i] !== '_' && src[i] !== '^') out += ' ';
      } else if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name];
      } else {
        out += name; // bilinmeyen komut: adı olduğu gibi
      }
    } else if (ch === '^' || ch === '_') {
      const [a, j] = readArg(src, i + 1);
      i = j;
      const body = latexToText(a);
      out += ch === '^' ? mapScript(body, SUP, '^') : mapScript(body, SUB, '_');
    } else if (ch === '{' || ch === '}') {
      i++;
    } else if (ch === '&') {
      out += '   ';
      i++;
    } else if (ch === '~') {
      out += ' ';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/[ \t]{3,}/g, '  ').trim();
}
