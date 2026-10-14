// SixFinger işaretinden PWA ve Android ikonlarını üretir.
// Kullanım: npm run icons -w @sixfinger/web
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'scripts/icon-source.svg'), 'utf8');
const withScale = (s) => source.replace(/scale\([\d.]+\)/, `scale(${s})`);

const out = (p) => {
  const full = join(root, p);
  mkdirSync(dirname(full), { recursive: true });
  return full;
};

async function png(svg, size, file) {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out(file));
  console.log('✓', file);
}

// Standart simge: işaret yüksekliğin ~%56'sı
await png(withScale(5.4), 192, 'public/icons/icon-192.png');
await png(withScale(5.4), 512, 'public/icons/icon-512.png');
// Maskable: güvenli alan için daha küçük
await png(withScale(4.0), 512, 'public/icons/maskable-512.png');
// Android kaynakları (capacitor-assets uyumlu)
await png(withScale(5.4), 1024, 'resources/icon-only.png');
await png(withScale(4.0), 1024, 'resources/icon-foreground.png');

// Arka plan düz renk
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#0b0b0c' } })
  .png()
  .toFile(out('resources/icon-background.png'));
console.log('✓ resources/icon-background.png');

// Açılış ekranı: koyu zemin + ortada işaret
const mark = source.match(/<g[\s\S]*<\/g>/)[0].replace(/scale\([\d.]+\)/, 'scale(2.6)').replace('translate(512 512)', 'translate(1366 1366)');
const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="#0b0b0c"/>${mark}</svg>`;
await sharp(Buffer.from(splash), { density: 96 }).resize(2732, 2732).png().toFile(out('resources/splash.png'));
console.log('✓ resources/splash.png');
writeFileSync(out('resources/.gitkeep'), '');
