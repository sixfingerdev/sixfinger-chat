import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const apiTarget = process.env.VITE_DEV_API ?? 'http://localhost:8787';
/**
 * Geliştirme sunucusuna hangi Host başlıklarıyla erişilebileceği. Tünel/uzak
 * önizleme adresleri (ör. *.e2b.app) için: VITE_DEV_ALLOWED_HOSTS='*' ya da
 * virgülle ayrılmış liste. Boşsa Vite'ın varsayılanı (localhost + IP) geçerlidir.
 */
const allowedHosts = (process.env.VITE_DEV_ALLOWED_HOSTS ?? '').trim();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo.svg', 'icons/*.png'],
      manifest: {
        name: 'SixFinger',
        short_name: 'SixFinger',
        description: 'SixFinger AI sohbet asistanı',
        lang: 'tr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0b0b0c',
        theme_color: '#0b0b0c',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4_000_000,
      },
    }),
  ],
  server: {
    port: 5173,
    allowedHosts: allowedHosts
      ? allowedHosts === '*'
        ? true
        : allowedHosts
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean)
      : undefined,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
