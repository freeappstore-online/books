import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from '@freeappstore/sdk/pwa-config'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions({
    // silence.wav primes the narration <audio> on iOS; it must load offline too (books#7)
    workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wav}'] },
  }))],
  server: { host: true },
})
