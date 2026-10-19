import type { MessagePartDTO } from './types.ts';
import { en } from './i18n/en.ts';
import { tr } from './i18n/tr.ts';
import { splitMcpToolName } from './mcp.ts';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

function host(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return String(url ?? '');
  }
}

const oneLine = (v: unknown): string => String(v ?? '').split('\n')[0]!.slice(0, 80);

/** Araç kartının başlığı ve tek satırlık ayrıntısı (iki istemci de aynı metni kullanır). */
export function describeTool(part: ToolPart, locale: 'tr' | 'en'): { label: string; detail: string } {
  const d = locale === 'tr' ? tr : en;
  const running = part.status === 'running';
  switch (part.name) {
    case 'web_search':
      return { label: running ? d['tool.searching'] : d['tool.web_search'], detail: String(part.args.query ?? '') };
    case 'web_fetch':
      return { label: running ? d['tool.fetching'] : d['tool.web_fetch'], detail: host(part.args.url) };
    case 'bash':
      return { label: running ? d['tool.running.bash'] : d['tool.bash'], detail: oneLine(part.args.command) };
    case 'read':
      return { label: running ? d['tool.running.read'] : d['tool.read'], detail: String(part.args.path ?? '') };
    case 'write':
      return { label: running ? d['tool.running.write'] : d['tool.write'], detail: String(part.args.path ?? '') };
    case 'edit':
      return { label: running ? d['tool.running.edit'] : d['tool.edit'], detail: String(part.args.path ?? '') };
    default: {
      const m = splitMcpToolName(part.name);
      if (m) return { label: `${String(part.meta?.server ?? m.server)} › ${String(part.meta?.tool ?? m.tool)}`, detail: '' };
      return { label: part.name, detail: '' };
    }
  }
}
