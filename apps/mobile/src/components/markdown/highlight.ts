import { common, createLowlight } from 'lowlight';
import type { Palette } from '../../theme/tokens.ts';

const lowlight = createLowlight(common);

export interface Token {
  text: string;
  color?: string;
}

type HNode = { type: 'text'; value: string } | { type: 'element'; properties?: { className?: string[] }; children: HNode[] };

function colorFor(classes: string[] | undefined, hl: Palette['hl']): string | undefined {
  if (!classes) return undefined;
  for (const raw of classes) {
    const c = raw.replace(/^hljs-/, '');
    if (c === 'comment' || c === 'quote' || c === 'doctag') return hl.comment;
    if (c === 'keyword' || c === 'selector-tag' || c === 'meta' || c === 'literal' || c === 'built_in') return hl.keyword;
    if (c === 'string' || c === 'regexp' || c === 'addition' || c === 'symbol' || c === 'template-variable') return hl.string;
    if (c === 'number') return hl.number;
    if (c === 'title' || c === 'function' || c === 'section' || c === 'selector-id') return hl.title;
    if (c === 'type' || c === 'class' || c === 'selector-class') return hl.type;
    if (c === 'attr' || c === 'attribute' || c === 'variable' || c === 'property' || c === 'params' || c === 'name') return hl.attr;
  }
  return undefined;
}

function flatten(nodes: HNode[], hl: Palette['hl'], inherited: string | undefined, out: Token[]): void {
  for (const n of nodes) {
    if (n.type === 'text') {
      const last = out[out.length - 1];
      if (last && last.color === inherited) last.text += n.value;
      else out.push({ text: n.value, color: inherited });
    } else {
      flatten(n.children, hl, colorFor(n.properties?.className, hl) ?? inherited, out);
    }
  }
}

/** Kodu satırlara bölünmüş renk parçalarına çevirir. Dil bilinmiyorsa düz metin döner. */
export function highlightCode(code: string, lang: string, hl: Palette['hl']): Token[][] {
  let tokens: Token[] = [{ text: code }];
  const language = lang.toLowerCase();
  if (language && lowlight.registered(language) && code.length < 20_000) {
    try {
      const tree = lowlight.highlight(language, code);
      tokens = [];
      flatten(tree.children as unknown as HNode[], hl, undefined, tokens);
    } catch {
      tokens = [{ text: code }];
    }
  }
  // Satırlara böl (token'lar satır sonlarını içerebilir).
  const lines: Token[][] = [[]];
  for (const t of tokens) {
    const parts = t.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1]!.push({ text: p, color: t.color });
    });
  }
  return lines;
}
