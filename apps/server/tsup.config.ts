import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate-cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Paylaşılan paket TS kaynağı olarak yayımlanıyor; pakete dahil et.
  noExternal: ['@sixfinger/shared'],
  onSuccess: async () => {
    cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
  },
});
