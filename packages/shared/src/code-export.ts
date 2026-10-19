import type { MessageDTO, MessagePartDTO } from './types.ts';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Bir araç parçasını tek satırlık Markdown maddesine çevirir (gösterilmeyecek parçalar için null). */
export function toolLine(p: ToolPart): string | null {
  const m = (p.meta ?? {}) as Record<string, unknown>;
  switch (p.name) {
    case 'bash': {
      const cmd = (str(m.command) || str(p.args.command)).split('\n')[0]!.slice(0, 160);
      const exit = m.exitCode;
      return `- \`$ ${cmd}\`${typeof exit === 'number' && exit !== 0 ? ` (exit ${exit})` : ''}`;
    }
    case 'edit':
    case 'write': {
      const f = (Array.isArray(m.files) ? (m.files[0] as Record<string, unknown>) : undefined) ?? {};
      const path = str(f.path) || str(p.args.path);
      return `- ${p.name === 'write' ? 'Wrote' : 'Edited'} \`${path}\` (+${num(f.additions)} −${num(f.deletions)})`;
    }
    case 'read':
      return `- Read \`${str(p.args.path)}\``;
    case 'grep':
    case 'glob':
      return `- Searched \`${str(p.args.pattern)}\``;
    case 'commit':
      return `- Commit \`${str(m.sha).slice(0, 7) || p.summary || ''}\` ${str(m.subject) || str(p.args.message)}`.trimEnd();
    case 'pull_request': {
      if (p.status === 'error') return `- Pull request failed: ${p.summary ?? ''}`.trimEnd();
      const url = str(m.url) || (p.output?.startsWith('http') ? p.output : '');
      return url ? `- Pull request #${String(m.number)}: ${url}` : '- Pull request updated';
    }
    case 'task':
      return `- Sub-agent: ${str(m.description) || str(p.args.description)}`;
    default:
      return null;
  }
}

export interface CodeExportMeta {
  title: string;
  repo: string;
  branch: string;
  base: string;
  prUrl?: string | null;
}

/** Code oturumunun dökümü (Markdown): mesajlar + araç adımlarının özeti + plan/soru kartları. */
export function codeTranscriptMarkdown(meta: CodeExportMeta, path: MessageDTO[], labels: { you: string; ai: string }): string {
  const out: string[] = [`# ${meta.title}`, '', `${meta.repo} · \`${meta.branch}\` (base \`${meta.base}\`)${meta.prUrl ? ` · ${meta.prUrl}` : ''}`, ''];
  for (const m of path) {
    if (m.role === 'user') {
      out.push(`## ${labels.you}`, '', m.content.trim(), '');
      continue;
    }
    out.push(`## ${labels.ai}`, '');
    const parts = m.parts?.length ? m.parts : [{ type: 'text' as const, text: m.content }];
    let list: string[] = [];
    const flush = () => {
      if (list.length) out.push(...list, '');
      list = [];
    };
    for (const p of parts) {
      if (p.type === 'reasoning') continue;
      if (p.type === 'text') {
        flush();
        if (p.text.trim()) out.push(p.text.trim(), '');
        continue;
      }
      if (p.name === 'exit_plan_mode') {
        flush();
        out.push('> **Plan**', ...str(p.meta?.plan).split('\n').map((l) => `> ${l}`), '');
        continue;
      }
      if (p.name === 'ask_user') {
        flush();
        const qs = Array.isArray(p.meta?.questions) ? (p.meta.questions as Array<{ question?: string; options?: Array<{ label?: string }> }>) : [];
        for (const q of qs) out.push(`> **${q.question ?? ''}** ${(q.options ?? []).map((o) => o.label).join(' / ')}`, '');
        continue;
      }
      const line = toolLine(p);
      if (line) list.push(line);
    }
    flush();
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
