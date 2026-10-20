import { IMAGE_LIMITS } from '@sixfinger/shared';
import { fetchImageBlob } from './api.ts';

export interface PendingImage {
  name: string;
  mime: 'image/jpeg';
  /** Base64 (başlıksız) */
  data: string;
  /** Küçük resim için yerel adres (object URL). */
  preview: string;
}

const MAX_SIDE = 1280;

/** Görseli uzun kenarı en çok 1280 px olacak şekilde küçültüp JPEG'e çevirir; sunucu sınırının altında kalana dek kaliteyi düşürür. */
export async function prepareImage(file: File): Promise<PendingImage> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // saydam PNG'ler JPEG'de siyah kalmasın
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  let blob: Blob | null = null;
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= IMAGE_LIMITS.maxBytes) break;
  }
  if (!blob || blob.size > IMAGE_LIMITS.maxBytes) throw new Error('image too large');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const base = file.name.replace(/\.[^.]+$/, '') || 'gorsel';
  return { name: `${base}.jpg`, mime: 'image/jpeg', data: btoa(bin), preview: URL.createObjectURL(blob) };
}

// ---- Görsel adresleri: yerel (gönderilmekte olan) ve sunucudaki (kimlik doğrulamalı) ----
const cache = new Map<string, Promise<string>>();

/** Gönderim sırasında henüz sunucu kimliği olmayan görsel için yerel adresi kaydeder. */
export function seedLocalImage(id: string, url: string): void {
  cache.set(id, Promise.resolve(url));
}

/** Görselin gösterilebilir adresi: kimlik doğrulamalı uçtan blob olarak çekilir ve önbelleğe alınır. */
export function imageUrl(id: string): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    p = fetchImageBlob(id).then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}
