// Bookmarks, highlights and the reading position (books#11, books#26).
import { test, expect, stubHuggingFace, alice, selectText, SLUG } from './fixtures'
import type { Page } from '@playwright/test'

const PROGRESS = { [SLUG]: { chapterIdx: 5, totalChapters: 12, scroll: 0.5, fraction: 0.45, lastRead: 1 } }

/** A highlight of chapter `chapterIdx` from `start` to `end`, as the reader stores it. */
const highlight = (id: string, chapterIdx: number, start: number, end: number, text = alice.chapters[chapterIdx].content.slice(start, end)) =>
  ({ id, kind: 'highlight', chapterIdx, start, end, color: 'yellow', text, created: 1 })

const stored = (page: Page, key: string) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), key)
/** Highlights drawn in the chapter: id → their text (one may span paragraphs). */
const drawn = (page: Page) => page.locator('[data-mark^="hl-"]').evaluateAll(els => Object.entries(els.reduce<Record<string, string>>((all, e) => {
  const id = e.getAttribute('data-mark')!
  all[id] = (all[id] ?? '') + e.textContent
  return all
}, {})))

test.beforeEach(async ({ context, baseURL }) => {
  await stubHuggingFace(context, baseURL!)
})

test('two tabs: highlights and finished marks made in one show in the other, and neither erases the other', async ({ context, page }) => {
  const other = await context.newPage()
  for (const p of [page, other]) {
    await p.goto(`/read/${SLUG}`)
    await p.waitForSelector('article h2')
  }
  await selectText(page, 5000, 5020)
  await page.getByRole('button', { name: 'Highlight yellow' }).click()
  await expect.poll(() => drawn(other), { message: 'shows in the other tab' }).toHaveLength(1)
  await selectText(other, 6000, 6020)
  await other.getByRole('button', { name: 'Highlight green' }).click()
  await expect.poll(() => drawn(page), { message: 'both in the first tab' }).toHaveLength(2)
  expect((await stored(page, 'bp-annotations'))[SLUG]).toHaveLength(2)

  // Finished, from the last chapter of each tab
  const last = alice.chapters.length - 1
  for (const p of [page, other]) await p.goto(`/read/${SLUG}?ch=${last}&at=0`)
  await page.getByRole('button', { name: 'Mark as finished' }).click()
  await expect(other.getByRole('button', { name: '✓ Finished' })).toBeVisible()
  await other.evaluate(() => localStorage.setItem('bp-finished', JSON.stringify({ ...JSON.parse(localStorage.getItem('bp-finished')!), dracula: 1 })))
  await other.getByRole('button', { name: '✓ Finished' }).click()
  await page.getByRole('button', { name: 'Mark as finished' }).click()
  expect(Object.keys(await stored(page, 'bp-finished')).sort()).toEqual([SLUG, 'dracula'])
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
