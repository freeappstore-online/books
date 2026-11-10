import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests of the pure logic (books#16). Kept apart from vite.config.ts so the
// PWA and Tailwind plugins don't load; browser behaviour is covered by e2e/.
export default defineConfig({
  // The test edition, not the app's own, so a language app runs the same tests (test/edition/README.md)
  resolve: { alias: { '@edition': fileURLToPath(new URL('test/edition', import.meta.url)) } },
  test: {
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/unit/setup.ts'],
  },
})
