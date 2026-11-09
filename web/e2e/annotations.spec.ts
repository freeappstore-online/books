// Bookmarks, highlights and the reading position (books#11, books#26).
import { test, expect, stubHuggingFace, alice, selectText, SLUG } from './fixtures'
import type { Page } from '@playwright/test'

const PROGRESS = { [SLUG]: { chapterIdx: 5, totalChapters: 12, scroll: 0.5, fraction: 0.45, lastRead: 1 } }

/** A highlight of chapter `chapterIdx` from `start` to `end`, as the reader stores it. */
const highlight = (id: string, chapterIdx: number, start: number, end: number, text = alice.chapters[chapterIdx].content.slice(start, end)) =>
  ({ id, kind: 'highlight', chapterIdx, start, end, color: 'yellow', text, created: 1 })

const stored = (page: Page, key: string) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), key)
const drawn = (page: Page) => page.locator('[data-mark^="hl-"]').evaluateAll(els => els.map(e => [e.getAttribute('data-mark'), e.textContent]))

test.beforeEach(async ({ context, baseURL }) => {
  await stubHuggingFace(context, baseURL!)
})

test('excerpt fallback keeps the reading position and shows or makes no annotations', async ({ context, page }) => {
  await page.goto('/')
  await page.evaluate(([progress, notes]) => {
    localStorage.setItem('bp-reading-progress', JSON.stringify(progress))
    localStorage.setItem('bp-annotations', JSON.stringify(notes))
  }, [PROGRESS, { [SLUG]: [highlight('hl-a', 0, 0, 40)] }] as const)
  // The book's text can't be fetched: the reader shows the excerpt
  await context.route('**/catalog/alice-in-wonderland.json', route => route.abort())
  await page.goto(`/read/${SLUG}`)
  await expect(page.locator('article h2')).toHaveText('Excerpt')
  await page.evaluate(() => window.scrollBy(0, 200))
  await page.waitForTimeout(600)
  expect((await stored(page, 'bp-reading-progress'))[SLUG], 'position kept').toEqual(PROGRESS[SLUG])
  expect(await drawn(page), 'chapter 1 highlights not drawn on the excerpt').toEqual([])

  await selectText(page, 0, 10)
  await page.waitForTimeout(400)
  await expect(page.getByRole('toolbar', { name: 'Highlight' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Bookmarks and notes' }).click()
  await expect(page.getByRole('button', { name: /Bookmark this place/ })).toBeDisabled()
  expect((await stored(page, 'bp-annotations'))[SLUG]).toHaveLength(1)
})
