import { readFileSync } from 'node:fs'
import { test, expect, stubHuggingFace } from './fixtures'

// Real chapters containing long compound words, Greek text, verse and an ASCII table.
const cases = [
  { slug: 'the-wind-in-the-willows', chapter: 0 },
  { slug: 'she', chapter: 3 },
  { slug: 'paradise-lost', chapter: 0 },
  { slug: 'les-miserables', chapter: 227 },
]

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  for (const large of [false, true]) {
    test.describe(`${viewport.width}px, ${large ? 'largest' : 'default'} text`, () => {
      test.use({ viewport })

      for (const { slug, chapter } of cases) {
        test(`${slug} chapter ${chapter + 1} wraps without horizontal scrolling or losing text`, async ({ context, baseURL, page }) => {
          await stubHuggingFace(context, baseURL!)
          if (large) await context.addInitScript(() => {
            localStorage.setItem('bp-font-size', '32')
            localStorage.setItem('bp-ui-scale', '150')
          })
          const book = JSON.parse(readFileSync(new URL(`../test/edition/texts/${slug}.json`, import.meta.url), 'utf8'))
          await page.goto(`/read/${slug}/?ch=${chapter}`)
          const text = page.locator('[data-chapter-text]')
          await expect(text).toBeVisible()
          await expect(text).toHaveText(book.chapters[chapter].content, { useInnerText: false })
          await page.waitForLoadState('networkidle')
          const bounds = await text.evaluate(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            const rects = [...range.getClientRects()]
            return {
              viewport: document.documentElement.clientWidth,
              page: document.documentElement.scrollWidth,
              textRight: Math.max(...rects.map(r => r.right)),
              textLeft: Math.min(...rects.map(r => r.left)),
              actualText: el.textContent,
            }
          })
          // Checking glyph bounds as well as page width prevents hiding overflow as a "fix".
          expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1)
          expect(bounds.textRight).toBeLessThanOrEqual(bounds.viewport + 1)
          expect(bounds.textLeft).toBeGreaterThanOrEqual(-1)
          expect(bounds.actualText).toBe(book.chapters[chapter].content)
          await page.evaluate(() => window.scrollTo({ left: 1000, top: window.scrollY, behavior: 'instant' }))
          expect(await page.evaluate(() => window.scrollX)).toBe(0)
        })
      }
    })
  }
}
