// Bookmarks, highlights and the reading position (books#11, books#26).
import { test, expect, stubHuggingFace, alice, audio, bar, expectPlaying, headerPlay, marks, selectText, SLUG } from './fixtures'
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

test('highlights follow their text after it changed; one whose text is gone is listed, not drawn', async ({ page }) => {
  const text = alice.chapters[0].content.slice(3000, 3030)
  await page.goto('/')
  await page.evaluate(notes => localStorage.setItem('bp-annotations', JSON.stringify(notes)), {
    // Saved against a text 7 characters shorter before this point, and one against text that is gone
    [SLUG]: [highlight('hl-moved', 0, 2993, 3023, text), highlight('hl-gone', 0, 4000, 4020, 'Words no longer in the book')],
  })
  await page.goto(`/read/${SLUG}`)
  await page.waitForSelector('article h2')
  await expect.poll(() => drawn(page)).toEqual([['hl-moved', text]])
  await page.getByRole('button', { name: 'Bookmarks and notes' }).click()
  await expect(page.getByRole('region', { name: 'Bookmarks and notes' }).getByRole('listitem')
    .filter({ hasText: 'Words no longer in the book' })).toContainText('Text changed')
})

test('text can be selected and highlighted in the paragraph being read aloud', async ({ page }) => {
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0)
  await page.waitForSelector('[data-readalong="word"]')
  // Ahead of the spoken word in the same paragraph, so the word moves through it meanwhile
  const at = await page.evaluate(() => {
    const root = document.querySelector('[data-chapter-text]')!
    const r = document.createRange()
    r.setStart(root, 0)
    r.setEndBefore(document.querySelector('[data-readalong="word"]')!)
    return r.toString().length
  })
  const [start, end] = [at + 10, at + 70]
  const words = alice.chapters[0].content.slice(start, end)
  expect(words, 'one paragraph').not.toContain('\n\n')
  await selectText(page, start, end)
  const toolbar = page.getByRole('toolbar', { name: 'Highlight' })
  await expect(toolbar).toBeVisible()
  // The narration reads on through the selection (timings: 60 chars a second)
  await page.waitForTimeout(2000)
  expect(await page.evaluate(() => getSelection()!.toString()), 'selection kept').toBe(words)
  expect((await audio(page))!.paused).toBe(false)
  await toolbar.getByRole('button', { name: 'Highlight pink' }).click()
  const saved = (await stored(page, 'bp-annotations'))[SLUG]
  expect(saved.map((a: { start: number; end: number; text: string }) => [a.start, a.end, a.text])).toEqual([[start, end, words.trim()]])
  // Released: the read-along moves on in that paragraph again
  await expect.poll(async () => (await marks(page)).word).toBeTruthy()
})

test('the highlight toolbar stays with the selection as the page scrolls, and hides under the header', async ({ page }) => {
  await page.goto(`/read/${SLUG}`)
  await page.waitForSelector('article h2')
  await selectText(page, 5000, 5020)
  const toolbar = page.getByRole('toolbar', { name: 'Highlight' })
  await expect(toolbar).toBeVisible()
  const gap = async () => {
    const [t, s] = [await toolbar.boundingBox(), await page.evaluate(() => getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON())]
    return t ? Math.round(t.y - s.bottom) : null
  }
  const before = await gap()
  // The app scrolls smoothly (CSS); measure after the scroll, not during it
  await page.evaluate(() => window.scrollBy({ top: 60, behavior: 'instant' }))
  // Within a pixel: subpixel layout rounds differently after a scroll
  await expect.poll(async () => Math.abs((await gap())! - before!) <= 1, { message: 'same place under the selection' }).toBe(true)
  // The selection under the sticky header
  await page.evaluate(() => {
    const s = getSelection()!.getRangeAt(0).getBoundingClientRect()
    window.scrollBy({ top: s.bottom - 5, behavior: 'instant' })
  })
  await expect(toolbar).toHaveCount(0)
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

test('excerpt fallback of a narrated book is reading-only: no Play, and no click or key starts narration (books#35)', async ({ context, page }) => {
  await context.route('**/catalog/alice-in-wonderland.json', route => route.abort())
  await page.goto(`/read/${SLUG}`)
  await expect(page.locator('article h2')).toHaveText('Excerpt')
  // The manifest has loaded by now, so the full book would show Play
  await page.waitForLoadState('networkidle')
  await expect(headerPlay(page)).toHaveCount(0)
  await expect(page.locator('[data-chapter-text]')).not.toHaveAttribute('title', /listening/)

  await page.locator('[data-chapter-text]').click()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(' ')
  await page.keyboard.press('k')
  await page.waitForTimeout(500)
  expect((await audio(page))?.paused ?? true, 'nothing plays').toBe(true)
  await expect(bar(page)).toHaveCount(0)
})
