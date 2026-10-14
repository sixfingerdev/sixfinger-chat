import type { MessageDTO } from '@sixfinger/shared';
import { downloadFile, slugify } from './format.ts';

export function toMarkdown(title: string, path: MessageDTO[], labels: { you: string; ai: string }): string {
  const lines = [`# ${title}`, ''];
  for (const m of path) {
    if (!m.content.trim()) continue;
    lines.push(`## ${m.role === 'user' ? labels.you : labels.ai}`, '', m.content.trim(), '');
  }
  return lines.join('\n');
}

export function exportMarkdown(title: string, path: MessageDTO[], labels: { you: string; ai: string }): void {
  downloadFile(`${slugify(title)}.md`, toMarkdown(title, path, labels), 'text/markdown');
}

export function exportJson(title: string, path: MessageDTO[]): void {
  const data = {
    title,
    exportedAt: new Date().toISOString(),
    messages: path.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
  };
  downloadFile(`${slugify(title)}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export const PUBLIC_URL: string = (import.meta.env.VITE_PUBLIC_URL ?? '').replace(/\/$/, '') || window.location.origin;
