import * as ImagePicker from 'expo-image-picker';
import { IMAGE_LIMITS } from '@sixfinger/shared';
import { assistantNative } from '../assistant/native.ts';
import { getApiBase, sessionStore } from './api.ts';

export interface PendingImage {
  name: string;
  mime: 'image/jpeg';
  /** Base64 (başlıksız) */
  data: string;
  /** Yerel önizleme (dosya adresi). */
  preview: string;
}

/** Uzun kenar bu kadar piksele küçültülür; sunucu sınırı (≈900 KB) altında kalana dek kalite düşer. */
const MAX_SIDE = 1280;

/** Seçilen görseli (galeri ya da kamera) hazırlar: küçültür, yönünü düzeltir, JPEG'e çevirir. */
export async function prepareImage(uri: string, name: string): Promise<PendingImage> {
  if (!assistantNative) throw new Error('image tools unavailable');
  const r = await assistantNative.compressImage(uri, MAX_SIDE, IMAGE_LIMITS.maxBytes);
  const base = name.replace(/\.[^.]+$/, '') || 'gorsel';
  return { name: `${base}.jpg`, mime: 'image/jpeg', data: r.data, preview: r.path };
}

export type ImageSource = 'library' | 'camera';

/** Galeri ya da kamerayı açar; en çok `room` görsel döner. İptal/izin yoksa boş dizi. */
export async function pickImages(source: ImageSource, room: number): Promise<PendingImage[]> {
  let res: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return [];
    res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  } else {
    res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: room > 1, selectionLimit: room, quality: 1 });
  }
  if (res.canceled) return [];
  const out: PendingImage[] = [];
  for (const a of res.assets.slice(0, room)) out.push(await prepareImage(a.uri, a.fileName ?? 'gorsel'));
  return out;
}

// ---- Mesajdaki görseller ----
const local = new Map<string, string>();

/** Gönderilirken sunucu kimliği olmayan görsel için yerel önizlemeyi kaydeder. */
export function seedLocalImage(id: string, uri: string): void {
  local.set(id, uri);
}

/** `Image` için kaynak: yerel önizleme ya da kimlik doğrulamalı sunucu adresi. */
export function imageSource(id: string): { uri: string; headers?: Record<string, string> } {
  const l = local.get(id);
  if (l) return { uri: l };
  const token = sessionStore.read()?.accessToken;
  return { uri: `${getApiBase()}/api/images/${id}`, headers: token ? { authorization: `Bearer ${token}` } : undefined };
}
