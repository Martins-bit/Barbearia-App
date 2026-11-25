import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'

// https://vite.dev/config/
const manifest: Partial<ManifestOptions> = JSON.parse(
  readFileSync(
    new URL('./public/manifest.webmanifest', import.meta.url),
    'utf8',
  ),
)

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest,
      includeManifestIcons: true,
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api(?:\/|$)/,
          /^\/socket\.io(?:\/|$)/,
          /^\/messages(?:\/|$)/,
        ],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
    }),
  ],
})
