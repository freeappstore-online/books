import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests of the pure logic (books#16). Kept apart from vite.config.ts so the
// PWA and Tailwind plugins don't load; browser behaviour is covered by e2e/.
export default defineConfig({
  // The edition, as in vite.config.ts (docs/editions.md)
  resolve: { alias: { '@edition': resolve(process.env.BOOKS_EDITION || fileURLToPath(new URL('../edition', import.meta.url))) } },
  test: {
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/unit/setup.ts'],
  },
})
