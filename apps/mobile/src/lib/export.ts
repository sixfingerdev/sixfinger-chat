import { Share } from 'react-native';
import type { MessageDTO } from '@sixfinger/shared';

export function toMarkdown(title: string, path: MessageDTO[], labels: { you: string; ai: string }): string {
  const lines = [`# ${title}`, ''];
  for (const m of path) {
    if (!m.content.trim()) continue;
    lines.push(`## ${m.role === 'user' ? labels.you : labels.ai}`, '', m.content.trim(), '');
  }
  return lines.join('\n');
}

export function toJson(title: string, path: MessageDTO[]): string {
  return JSON.stringify(
    { title, exportedAt: new Date().toISOString(), messages: path.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })) },
    null,
    2,
  );
}

/** Sistemin paylaşım sayfasını açar (Drive, Notlar, e-posta…). */
export async function shareText(title: string, message: string): Promise<void> {
  try {
    await Share.share({ title, message });
  } catch {
    /* kullanıcı vazgeçti */
  }
}
