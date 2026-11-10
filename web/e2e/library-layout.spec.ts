import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { test, expect, stubHuggingFace, alice, HF, SLUG, wav } from './fixtures'

const catalog = JSON.parse(readFileSync(new URL('../test/edition/books.json', import.meta.url), 'utf8')) as {
  id: string; title: string; author: string; chapters: number
}[]
const aliceTitle = catalog.find(book => book.id === SLUG)!.title
const reading = catalog.find(book => book.id === 'a-connecticut-yankee')!
const finished = catalog.find(book => book.id === 'narrative-of-frederick-douglass')!
const oldSlug = `removed-book-${'UnbrokenArchiveTitle'.repeat(10)}`
const note = `https://example.test/notes/${'UnbrokenSavedNote'.repeat(18)}`
const bookmarkText = `Saved passage ${'UnbrokenBookmarkText'.repeat(12)}`

const section = (page: Page, name: string) => page.locator('main section').filter({
  has: page.getByRole('heading', { name, exact: true }),
})

/** Check rendered text as well as boxes: overflow:hidden must not turn a clipped UI green. */
async function expectLibraryFits(page: Page) {
  // Opening the notes rotates its disclosure glyph. Measure the settled result;
  // persistent clipped text or horizontal overflow still fails the same bounds.
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    const failures: string[] = []
    if (document.documentElement.scrollWidth > viewport + 1) {
      failures.push(`document width ${document.documentElement.scrollWidth} > viewport ${viewport}`)
    }
    for (const el of document.querySelectorAll<HTMLElement>('main a, main button, main summary, main h2, main li p')) {
      if (!el.getClientRects().length) continue
      const box = el.getBoundingClientRect()
      const label = `${el.tagName}: ${el.textContent?.trim().slice(0, 70)}`
      if (box.left < -1 || box.right > viewport + 1) failures.push(`${label}: box outside viewport`)
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) failures.push(`${label}: clipped or overflowing content`)
      const range = document.createRange()
      range.selectNodeContents(el)
      for (const text of range.getClientRects()) {
        if (text.width > 0 && (text.left < -1 || text.right > viewport + 1 || text.left < box.left - 1 || text.right > box.right + 1)) {
          failures.push(`${label}: rendered text outside its control or viewport`)
          break
        }
      }
    }
    return failures
  }), { message: 'every Library control and its text fits without clipping' }).toEqual([])
}

for (const { width, scale } of [
  { width: 320, scale: 100 }, { width: 390, scale: 100 },
  { width: 320, scale: 150 }, { width: 390, scale: 150 },
  { width: 1200, scale: 100 },
]) {
  test(`Library fits ${width}px at ${scale}% interface size with saved books and expanded long notes`, async ({ context, baseURL, page }) => {
    await page.setViewportSize({ width, height: 900 })
    // Only local app files and the deterministic narration fixture are needed.
    await context.route('https://**/*', route => route.abort())
    await stubHuggingFace(context, baseURL!, { inline: true })
    await context.addInitScript(() => {
      if (navigator.storage) {
        Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => ({ usage: 24 * 1024 ** 2, quota: 500 * 1024 ** 2 }) })
        Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => false })
      }
    })
    await page.goto('/library')
    await page.getByRole('heading', { name: 'In progress', exact: true }).waitFor()
    const audio = wav(1).toString('base64')
    await page.evaluate(async ({ slug, hf, readingBook, finishedBook, old, longNote, passage, uiScale, audioBase64, chapters }) => {
      const seed = async () => {
        const cache = await caches.open('books-offline-v1')
        const textUrl = `${location.origin}/catalog/${slug}.json`
        const oldUrl = `${location.origin}/catalog/${old}.json`
        const audioUrl = `${hf}af_heart/${slug}/0.m4a`
        const text = JSON.stringify({ chapters })
        const audioBytes = Uint8Array.from(atob(audioBase64), ch => ch.charCodeAt(0))
        await cache.put(textUrl, new Response(text, { headers: { 'content-type': 'application/json' } }))
        await cache.put(oldUrl, Response.json({ chapters: [{ title: 'One', content: 'An older saved book.' }] }))
        await cache.put(audioUrl, new Response(audioBytes, { headers: { 'content-type': 'audio/wav' } }))
        localStorage.setItem('bp-ui-scale', String(uiScale))
        localStorage.setItem('bp-reading-progress', JSON.stringify({
          [slug]: { chapterIdx: 3, totalChapters: chapters.length, scroll: 0.4, fraction: 0.3, lastRead: 20 },
          [readingBook.id]: { chapterIdx: 10, totalChapters: readingBook.chapters, scroll: 0.5, fraction: 0.25, lastRead: 10 },
        }))
        localStorage.setItem('bp-audio-history', JSON.stringify([{ slug, title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll', chapterIdx: 3, timestamp: 20 }]))
        localStorage.setItem('bp-finished', JSON.stringify({ [finishedBook.id]: 30 }))
        localStorage.setItem('bp-annotations', JSON.stringify({ [slug]: [{
          id: 'bm-layout', kind: 'bookmark', chapterIdx: 3, start: 0, end: 0,
          text: passage, note: longNote, created: 1,
        }] }))
        // A real old save: one audio chapter, with eleven new ones available and no format marker.
        localStorage.setItem('bp-offline-books', JSON.stringify({
          [slug]: { voice: 'af_heart', files: { [textUrl]: text.length, [audioUrl]: audioBytes.length }, savedAt: 1 },
          [old]: { voice: null, files: { [oldUrl]: 100 }, savedAt: 1, format: 2 },
        }))
      }
      if (navigator.locks) await navigator.locks.request('bp-offline-files', seed)
      else await seed()
    }, { slug: SLUG, hf: HF, readingBook: reading, finishedBook: finished, old: oldSlug, longNote: note, passage: bookmarkText, uiScale: scale, audioBase64: audio, chapters: alice.chapters })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('style', new RegExp(`font-size: ${scale}%`))
    const progress = section(page, 'In progress')
    const done = section(page, 'Finished')
    const notes = section(page, 'Bookmarks and notes')
    const saved = section(page, 'Saved on this device')
    const savedAlice = saved.locator('div').filter({ has: page.getByRole('link', { name: aliceTitle, exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Remove', exact: true }) }).last()
    // WebKit can evict cached responses on reload, making repair take precedence
    // over new chapters. Either descriptive Update action exercises the same layout.
    const updateAlice = savedAlice.getByRole('button', { name: /^Update \(.+\)$/ })
    await expect(progress).toContainText(reading.title)
    await expect(done).toContainText(finished.title)
    await expect(updateAlice).toBeVisible()
    await notes.locator('summary').click()
    await expect(notes.locator('details')).toHaveAttribute('open', '')
    await expect(notes.locator('li p')).toHaveText(note)
    await expect(notes.getByRole('button', { name: bookmarkText, exact: true })).toHaveText(bookmarkText)
    await expect(saved.getByRole('link', { name: oldSlug, exact: true })).toHaveText(oldSlug)
    await page.evaluate(() => document.fonts.ready)
    await expectLibraryFits(page)

    // Hit-testing checks keep a superficially fitting but covered/unreachable action from passing.
    for (const name of ['Resume', 'Listen', 'Mark as finished']) await progress.getByRole(name === 'Resume' ? 'link' : 'button', { name, exact: true }).first().click({ trial: true })
    for (const name of ['Go to', 'Edit', 'Delete', 'Export Markdown']) await notes.getByRole('button', { name, exact: true }).click({ trial: true })
    await updateAlice.click({ trial: true })
    await done.getByRole('button', { name: 'Not finished', exact: true }).click()
    await expect(done).toHaveCount(0)
    await expectLibraryFits(page)

    // Removing the obsolete save remains usable even with its exceptionally long fallback title.
    const oldRow = saved.locator('div').filter({ has: page.getByRole('link', { name: oldSlug, exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Remove', exact: true }) }).last()
    await oldRow.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(saved.getByRole('link', { name: oldSlug, exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bp-annotations')!)["alice-in-wonderland"][0].note)).toBe(note)
    await expectLibraryFits(page)
  })
}
