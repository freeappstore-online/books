import {
  test, expect, stubHuggingFace, bar, expectPlaying, headerPlay, openChapter, openReaderMore, trackButton,
  partial, PARTIAL,
} from './fixtures'
import type { Page } from '@playwright/test'

// A partly narrated book without timings, as the books published in books#31:
// chapters 1, 2 (3 s) and 18 narrated, 3–17 reading-only

const LAST = partial.chapters.length - 1

/** Console errors, other than the browser's own line for a 404 (a chapter's missing timings). */
function consoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  return errors
}

test('reading and available audio have separate time estimates, retained when paused', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!, { partial: true })
  await page.goto(`/read/${PARTIAL}`)
  const reading = page.locator('article span[title="Estimated reading time"]')
  const listening = page.locator('article span', { hasText: /^Listening at/ })
  await expect(reading).toContainText('Reading:')
  // The middle fifteen chapters contribute no audio: 603 s, not a reading estimate for them.
  await expect(listening).toContainText('10 min available audio left')
  await headerPlay(page).click()
  await expectPlaying(page, 0, 1)
  for (let i = 0; i < 3; i++) await page.getByLabel('Forward 30 seconds').click()
  await expect(listening).toContainText('9 min available audio left')
  await bar(page).getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(listening).toContainText('9 min available audio left')
  // An unnarrated chapter still has its reading estimate and only the later audio is counted.
  await openChapter(page, 4, partial)
  await expect(listening).toContainText('no audio for this chapter')
  await expect(listening).toContainText('5 min available audio left')
  await expect(reading).toContainText('left in book')
})

test('plays the narrated chapters without read-along, passes over the rest, which have no Play', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { partial: true })
  const errors = consoleErrors(page)
  await page.goto(`/read/${PARTIAL}`)
  await expect(headerPlay(page)).toBeVisible()
  await headerPlay(page).click()
  await expectPlaying(page, 0, 1)
  // No timings: no highlight, and the missing file is asked for once, not retried
  await page.waitForTimeout(1000)
  await expect(page.locator('[data-readalong]')).toHaveCount(0)
  expect(hf.requests.filter(p => p === `af_heart/${PARTIAL}/0.timings.json`)).toHaveLength(1)

  // Chapter 2 (3 s) ends and playback moves on to chapter 18, past the unnarrated ones
  await trackButton(page, 'Next')
  await expectPlaying(page, 1, 0)
  await expectPlaying(page, LAST)
  await expect(page.locator('article h2')).toContainText(partial.chapters[LAST].title)
  // The player's chapter list offers only the narrated chapters
  await bar(page).getByRole('button', { name: 'Show chapters' }).click()
  await expect(bar(page).getByRole('button', { name: '5', exact: true })).toBeDisabled()
  await expect(bar(page).getByRole('button', { name: '2', exact: true })).toBeEnabled()
  await bar(page).getByRole('button', { name: 'Hide chapters' }).click()
  await bar(page).getByRole('button', { name: 'Pause' }).click()

  // An unnarrated chapter is reading-only
  await openChapter(page, 4, partial)
  await expect(page.locator('article h2')).toContainText(partial.chapters[4].title)
  await expect(headerPlay(page)).toHaveCount(0)
  await expect(page.locator('[title="Click to start listening from here"]')).toHaveCount(0)
  await openChapter(page, 0, partial)
  await expect(headerPlay(page)).toBeVisible()
  await expect(page.locator('[title="Click to start listening from here"]')).toHaveCount(1)

  // The catalogue lists it as an audiobook; Continue resumes its narration
  await page.goto('/')
  const audiobooks = page.locator('section', { has: page.getByRole('heading', { name: 'Audiobooks' }) })
  await expect(audiobooks.locator(`a[href="/read/${PARTIAL}/"]`)).toBeVisible()
  const shelf = page.locator('section[aria-labelledby="continue-heading"]')
  // Shows where it was read last (chapter 1); Listen resumes the narration where it stopped
  await expect(shelf).toContainText(`Ch 1/${partial.chapters.length}`)
  await shelf.getByRole('button', { name: 'Listen', exact: true }).click()
  await expectPlaying(page, LAST)
  expect(errors).toEqual([])
})

test('saves offline with a size estimate from its narrated chapters, without timings', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { partial: true, inline: true })
  await page.goto(`/read/${PARTIAL}`)
  await page.waitForSelector('article h2')
  await openReaderMore(page)
  const save = page.getByRole('button', { name: /Save offline/ })
  // 603 s at 5,200 bytes a second
  await expect(save).toHaveAttribute('title', /\(~3\.0 MB\)/)
  await save.click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 30_000 })
  expect(hf.requests.filter(p => p.endsWith('.m4a')).sort()).toEqual([0, 1, LAST].map(i => `af_heart/${PARTIAL}/${i}.m4a`).sort())
  // Each missing timings file asked for once (a 404 isn't retried)
  expect(hf.requests.filter(p => p.endsWith('.timings.json')).sort()).toEqual([0, 1, LAST].map(i => `af_heart/${PARTIAL}/${i}.timings.json`).sort())
  const files = await page.evaluate(slug => Object.keys(JSON.parse(localStorage.getItem('bp-offline-books')!)[slug].files), PARTIAL)
  expect(files.filter(f => f.endsWith('.m4a'))).toHaveLength(3)
  expect(files.filter(f => f.endsWith('.timings.json'))).toEqual([])
})

test('with the manifest\'s extras, asks for no timings it lacks: no 404s in the console (books#37)', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { partial: true, extras: { [PARTIAL]: {} } })
  const errors: string[] = []
  // (The stub aborts every other host, analytics and fonts: those fail without a status)
  page.on('console', m => { if (m.type() === 'error' && /404|not found/i.test(m.text())) errors.push(m.text()) })
  await page.goto(`/read/${PARTIAL}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0, 1)
  await trackButton(page, 'Next')
  await expectPlaying(page, 1, 0)
  await expectPlaying(page, LAST)
  expect(hf.requests.filter(p => p.endsWith('.timings.json'))).toEqual([])
  expect(errors).toEqual([])
})
