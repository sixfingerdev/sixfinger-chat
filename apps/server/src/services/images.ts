import { IMAGE_LIMITS, type ImageInput, type ImageRefDTO } from '@sixfinger/shared';
import type { Queryable } from '../db/pool.ts';
import { badRequest } from '../lib/errors.ts';
import type { AiImage } from './ai.ts';

/** Dosya imzası (magic bytes) bildirilen türle uyuşuyor mu? İstemciye güvenmeyiz. */
function sniff(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export interface CheckedImage {
  name: string;
  mime: string;
  bytes: Buffer;
}

/** Gelen base64 görselleri doğrular (boyut, tür, imza). */
export function checkImages(inputs: ImageInput[]): CheckedImage[] {
  return inputs.map((img) => {
    const bytes = Buffer.from(img.data, 'base64');
    if (bytes.length === 0 || bytes.length > IMAGE_LIMITS.maxBytes) throw badRequest('Görsel çok büyük. Daha küçük bir görsel dene.');
    const real = sniff(bytes);
    if (!real) throw badRequest('Görsel biçimi desteklenmiyor (JPEG, PNG ya da WebP olmalı).');
    return { name: img.name, mime: real, bytes };
  });
}

export async function saveImages(db: Queryable, messageId: string, userId: string, images: CheckedImage[]): Promise<ImageRefDTO[]> {
  const refs: ImageRefDTO[] = [];
  for (const [i, img] of images.entries()) {
    const r = await db.query<{ id: string }>(
      'insert into message_images (message_id, user_id, name, mime, data, position) values ($1, $2, $3, $4, $5, $6) returning id',
      [messageId, userId, img.name, img.mime, img.bytes, i],
    );
    refs.push({ id: r.rows[0]!.id, name: img.name, mime: img.mime });
  }
  return refs;
}

/** Mesaj kimliği → görsel başvuruları (tek sorgu). */
export async function imageRefs(db: Queryable, messageIds: string[]): Promise<Map<string, ImageRefDTO[]>> {
  const out = new Map<string, ImageRefDTO[]>();
  if (!messageIds.length) return out;
  const r = await db.query<{ id: string; message_id: string; name: string; mime: string }>(
    'select id, message_id, name, mime from message_images where message_id = any($1::uuid[]) order by message_id, position',
    [messageIds],
  );
  for (const row of r.rows) {
    const list = out.get(row.message_id) ?? [];
    list.push({ id: row.id, name: row.name, mime: row.mime });
    out.set(row.message_id, list);
  }
  return out;
}

/** Modele gidecek görseller (base64) — yalnızca verilen mesajlar için. */
export async function loadImages(db: Queryable, messageIds: string[]): Promise<Map<string, AiImage[]>> {
  const out = new Map<string, AiImage[]>();
  if (!messageIds.length) return out;
  const r = await db.query<{ message_id: string; mime: string; data: Buffer }>(
    'select message_id, mime, data from message_images where message_id = any($1::uuid[]) order by message_id, position',
    [messageIds],
  );
  for (const row of r.rows) {
    const list = out.get(row.message_id) ?? [];
    list.push({ mime: row.mime, data: row.data.toString('base64') });
    out.set(row.message_id, list);
  }
  return out;
}
