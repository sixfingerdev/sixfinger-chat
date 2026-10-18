import type { MessagePartDTO } from './types.ts';
import { en } from './i18n/en.ts';
import { tr } from './i18n/tr.ts';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

function host(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return String(url ?? '');
  }
}

/** Araç kartının başlığı ve tek satırlık ayrıntısı (iki istemci de aynı metni kullanır). */
export function describeTool(part: ToolPart, locale: 'tr' | 'en'): { label: string; detail: string } {
  const d = locale === 'tr' ? tr : en;
  const running = part.status === 'running';
  switch (part.name) {
    case 'web_search':
      return { label: running ? d['tool.searching'] : d['tool.web_search'], detail: String(part.args.query ?? '') };
    case 'web_fetch':
      return { label: running ? d['tool.fetching'] : d['tool.web_fetch'], detail: host(part.args.url) };
    default:
      return { label: part.name, detail: '' };
  }
}
