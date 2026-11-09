import { defineConfig } from 'vitest/config'

// Unit tests of the pure logic (books#16). Kept apart from vite.config.ts so the
// PWA and Tailwind plugins don't load; browser behaviour is covered by e2e/.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/unit/setup.ts'],
  },
})
