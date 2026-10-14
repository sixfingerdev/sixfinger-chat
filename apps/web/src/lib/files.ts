import { ATTACHMENT_MAX_CHARS } from '@sixfinger/shared';
import type { PendingAttachment } from './types.ts';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'html', 'htm', 'css', 'scss',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash',
  'zsh', 'sql', 'swift', 'dart', 'lua', 'r', 'tex', 'srt', 'vtt', 'gradle', 'dockerfile',
]);

export const ACCEPT_ATTR = [...TEXT_EXT].map((e) => `.${e}`).join(',') + ',text/*,application/json';

export type ReadResult = { ok: true; file: PendingAttachment } | { ok: false; reason: 'unsupported' | 'empty' };

export async function readTextFile(file: File, maxChars = ATTACHMENT_MAX_CHARS): Promise<ReadResult> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : file.name.toLowerCase();
  const looksText = file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXT.has(ext);
  if (!looksText || file.size > 5_000_000) return { ok: false, reason: 'unsupported' };
  const text = await file.text();
  if (text.includes('\u0000')) return { ok: false, reason: 'unsupported' }; // ikili dosya
  if (!text.trim()) return { ok: false, reason: 'empty' };
  const truncated = text.length > maxChars;
  return {
    ok: true,
    file: { name: file.name, mime: file.type || 'text/plain', text: truncated ? text.slice(0, maxChars) : text, truncated },
  };
}
