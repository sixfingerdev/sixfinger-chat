import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ATTACHMENT_MAX_CHARS } from '@sixfinger/shared';
import type { PendingAttachment } from './types.ts';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'html', 'htm', 'css', 'scss',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash',
  'zsh', 'sql', 'swift', 'dart', 'lua', 'r', 'tex', 'srt', 'vtt', 'gradle', 'dockerfile',
]);

export type PickResult =
  | { ok: true; file: PendingAttachment; uri: string; size: number }
  | { ok: false; reason: 'unsupported' | 'empty'; name: string; uri: string; size: number; mime: string };

/** Sistem dosya seçicisini açar; metin tabanlı dosyaları okuyup ek olarak döndürür. İptalde boş dizi. */
export async function pickTextFiles(max: number, maxChars = ATTACHMENT_MAX_CHARS): Promise<PickResult[]> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['text/*', 'application/json', '*/*'], multiple: max > 1, copyToCacheDirectory: true });
  if (res.canceled) return [];
  const out: PickResult[] = [];
  for (const asset of res.assets.slice(0, max)) {
    const name = asset.name;
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : name.toLowerCase();
    const mime = asset.mimeType ?? '';
    const looksText = mime.startsWith('text/') || mime === 'application/json' || TEXT_EXT.has(ext);
    if (!looksText || (asset.size ?? 0) > 5_000_000) {
      out.push({ ok: false, reason: 'unsupported', name, uri: asset.uri, size: asset.size ?? 0, mime });
      continue;
    }
    let text: string;
    try {
      text = await new File(asset.uri).text();
    } catch {
      out.push({ ok: false, reason: 'unsupported', name, uri: asset.uri, size: asset.size ?? 0, mime });
      continue;
    }
    if (text.includes('\u0000')) {
      out.push({ ok: false, reason: 'unsupported', name, uri: asset.uri, size: asset.size ?? 0, mime }); // ikili dosya
      continue;
    }
    if (!text.trim()) {
      out.push({ ok: false, reason: 'empty', name, uri: asset.uri, size: asset.size ?? 0, mime });
      continue;
    }
    const truncated = text.length > maxChars;
    out.push({ ok: true, uri: asset.uri, size: asset.size ?? text.length, file: { name, mime: mime || 'text/plain', text: truncated ? text.slice(0, maxChars) : text, truncated } });
  }
  return out;
}

/** Dosyanın içeriğini base64 olarak okur (çalışma alanına yükleme için). */
export async function readBase64(uri: string): Promise<string> {
  const bytes = await new File(uri).bytes();
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
