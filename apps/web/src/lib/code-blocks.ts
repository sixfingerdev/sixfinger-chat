import type { MessagePartDTO } from '@sixfinger/shared';

export type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

const GROUPED = new Set(['bash', 'read', 'glob', 'grep', 'web_search', 'web_fetch']);
const FILE_EDITS = new Set(['edit', 'write']);

export type Block =
  | { kind: 'reasoning'; text: string; ms: number | null; last: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'group'; parts: ToolPart[] }
  | { kind: 'file'; part: ToolPart }
  | { kind: 'todo'; part: ToolPart }
  | { kind: 'workspace'; part: ToolPart }
  | { kind: 'commit'; part: ToolPart }
  | { kind: 'compaction'; part: ToolPart }
  | { kind: 'pull_request'; part: ToolPart }
  | { kind: 'tool'; part: ToolPart };

/** Parçaları görünüm bloklarına çevirir: ardışık komut/okuma/arama parçaları tek satırda toplanır, yalnızca son todo listesi gösterilir. */
export function toBlocks(parts: MessagePartDTO[]): Block[] {
  const lastTodo = parts.map((p, i) => (p.type === 'tool' && p.name === 'todo' ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  const out: Block[] = [];
  parts.forEach((p, i) => {
    if (p.type === 'reasoning') return void out.push({ kind: 'reasoning', text: p.text, ms: p.ms, last: i === parts.length - 1 });
    if (p.type === 'text') return void out.push({ kind: 'text', text: p.text });
    if (GROUPED.has(p.name)) {
      const prev = out[out.length - 1];
      if (prev?.kind === 'group') prev.parts.push(p);
      else out.push({ kind: 'group', parts: [p] });
    } else if (FILE_EDITS.has(p.name)) out.push({ kind: 'file', part: p });
    else if (p.name === 'todo') {
      if (i === lastTodo) out.push({ kind: 'todo', part: p });
    } else if (p.name === 'workspace') out.push({ kind: 'workspace', part: p });
    else if (p.name === 'commit') out.push({ kind: 'commit', part: p });
    else if (p.name === 'compaction') out.push({ kind: 'compaction', part: p });
    else if (p.name === 'pull_request') out.push({ kind: 'pull_request', part: p });
    else out.push({ kind: 'tool', part: p });
  });
  return out;
}

/** Satır farkı: ortak baş ve son satırlar bağlam (soluk, en çok 2'şer), aradaki silinenler kırmızı, eklenenler yeşil. */
export function diffLines(old: string, next: string): Array<{ kind: 'ctx' | 'del' | 'add'; text: string }> {
  const lines = (s: string) => (s ? s.replace(/\n$/, '').split('\n') : []);
  const a = lines(old);
  const b = lines(next);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const ctx = (l: string[]) => l.map((text) => ({ kind: 'ctx' as const, text }));
  return [
    ...ctx(a.slice(Math.max(0, head - 2), head)),
    ...a.slice(head, a.length - tail).map((text) => ({ kind: 'del' as const, text })),
    ...b.slice(head, b.length - tail).map((text) => ({ kind: 'add' as const, text })),
    ...ctx(a.slice(a.length - tail, a.length - tail + 2)),
  ];
}

