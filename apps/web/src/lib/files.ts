import { ATTACHMENT_MAX_CHARS, UPLOAD_MAX_BYTES } from '@sixfinger/shared';
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

/** Dosyanın baytlarını base64'e çevirir (başlıksız). */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export type AnyFileResult = { ok: true; file: PendingAttachment } | { ok: false; reason: 'too_big' | 'empty' | 'unsupported' };

/**
 * Sandbox yüklemesi için dosya hazırlar: her tür dosya (ikili dahil) gönderimde çalışma alanına yazılır; model read/bash ile açar.
 * Metin dosyasının içeriği yedek olarak da saklanır (yükleme başarısız olursa mesaja gömülür). Sandbox hakkı yoksa yalnızca metin dosyaları.
 */
export async function readAnyFile(file: File, sandbox: boolean): Promise<AnyFileResult> {
  if (!sandbox) {
    const r = await readTextFile(file);
    return r.ok ? { ok: true, file: r.file } : { ok: false, reason: r.reason };
  }
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, reason: 'too_big' };
  const fallback = await readTextFile(file);
  return {
    ok: true,
    file: {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      text: fallback.ok && !fallback.file.truncated ? fallback.file.text : '',
      truncated: false,
      data: await fileToBase64(file),
      size: file.size,
    },
  };
}
