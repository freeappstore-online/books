import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from '@freeappstore/sdk/pwa-config'

// Book covers (public/covers/*.webp) stay out of the precache; they are cached as they are shown.
// maxEntries is above the catalogue size so a cover fetched for an offline book is never evicted.
const coverCache = {
  urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/covers/'),
  handler: 'CacheFirst' as const,
  options: { cacheName: 'book-covers-v1', expiration: { maxEntries: 300 } },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions({
    workbox: {
      // silence.wav primes the narration <audio> on iOS; it must load offline too (books#7)
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wav}'],
      runtimeCaching: [...(pwaOptions().workbox.runtimeCaching ?? []), coverCache],
    },
  }))],
  server: { host: true },
})
