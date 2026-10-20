import type { AiImage } from '../ai.ts';
import { sniff } from '../images.ts';
import { ToolError } from './errors.ts';
import type { ToolResult } from './types.ts';

const EXT = /\.(png|jpe?g|webp)$/i;

/** `read` ile açılan görsel dosyası modele görsel olarak gösterilir. Yalnızca JPEG/PNG/WebP. */
export const isImagePath = (path: string): boolean => EXT.test(path.trim());

/** Okunabilen en büyük görsel (bayt). Daha büyükse model küçültmeyi (bash) denemeli. */
export const READ_IMAGE_MAX_BYTES = 2_500_000;
export const READ_IMAGE_MAX_MB = 3;

/** Ham baytlardan araç sonucu üretir; imza dosya uzantısıyla uyuşmuyorsa hata verir. */
export function imageToolResult(path: string, bytes: Buffer): ToolResult {
  const mime = sniff(bytes);
  if (!mime) throw new ToolError(`${path} geçerli bir JPEG/PNG/WebP görseli değil (uzantı yanıltıcı olabilir).`);
  if (bytes.length > READ_IMAGE_MAX_BYTES) {
    throw new ToolError(`Görsel çok büyük (${Math.round(bytes.length / 1024)} KB; en fazla ${Math.round(READ_IMAGE_MAX_BYTES / 1024)} KB). bash ile küçült (örn. python3 + PIL ya da ImageMagick \`convert -resize 1280x1280\`) ve tekrar oku.`);
  }
  const img: AiImage = { mime, data: bytes.toString('base64') };
  return {
    output: `Görsel dosyası: ${path} (${mime}, ${Math.round(bytes.length / 1024)} KB). Görselin kendisi bu sonucun hemen ardından kullanıcı mesajı olarak eklendi; ona bakarak devam et.`,
    summary: `görsel · ${Math.round(bytes.length / 1024)} KB`,
    meta: { image: true, bytes: bytes.length },
    images: [img],
  };
}
