import {
  test, expect, stubHuggingFace, audio, bar, chapterOf, charPoint, expectPlaying, headerPlay,
  openChapter, trackButton, chapterUrl, SLUG, DURATIONS, SHORT_CH,
} from './fixtures'
import type { Page } from '@playwright/test'

/** The element keeps playing chapter `idx` (no late request takes over, no bounce). */
async function staysOn(page: Page, idx: number) {
  await page.waitForTimeout(1500)
  const a = await audio(page)
  expect(chapterOf(a), a?.src).toBe(idx)
  expect(a!.paused).toBe(false)
  await expect(bar(page)).toContainText(`Ch ${idx + 1}/`)
}

test.describe('the last request wins', () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    // Slow audio answers widen the window in which requests overlap
    await stubHuggingFace(context, baseURL!, { delayMs: 400 })
    await page.goto(`/read/${SLUG}`)
    await expect(headerPlay(page)).toBeVisible()
  })

  test('Next, Next in quick succession plays the second one', async ({ page }) => {
    await headerPlay(page).click()
    await expectPlaying(page, 0)
    await trackButton(page, 'Next')
    await trackButton(page, 'Next')
    await expectPlaying(page, 2)
    await staysOn(page, 2)
    await expect(page.locator('article h2')).toContainText('Chapter 3:')
  })

  test('Play then a word straight away plays from the word', async ({ page }) => {
    // Play alone would resume at 150 s
    await page.evaluate(url => localStorage.setItem('bp-prepared-positions', JSON.stringify({ [url]: 150 })), chapterUrl(0))
    // A word in the first lines: clicking Play doesn't scroll it away, and the
    // player bar that appears at the bottom doesn't cover it (phones)
    const pt = await charPoint(page, 40, false)
    await headerPlay(page).click()
    await page.mouse.click(pt.x, pt.y)
    await expectPlaying(page, 0)
    await staysOn(page, 0)
    // The word is spoken in the first seconds
    expect((await audio(page))!.t, 'plays from the word, not from 150 s').toBeLessThan(10)
  })
})

test('a pause the app did not make (headphones, a call) shows as paused and resumes there', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0, 1)
  await page.evaluate(() => (window as unknown as { __audios: HTMLAudioElement[] }).__audios[0].pause())
  await expect(headerPlay(page)).toBeVisible()
  await expect(bar(page).getByRole('button', { name: 'Resume' })).toBeVisible()
  const at = (await audio(page))!.t
  await page.waitForTimeout(1000)
  expect((await audio(page))!.paused).toBe(true)

  await bar(page).getByRole('button', { name: 'Resume' }).click()
  await expectPlaying(page, 0, at)
  expect((await audio(page))!.t).toBeLessThan(at + 3)
})

test.describe('chapters without narration', () => {
  test('Previous passes over a chapter without narration and does not bounce forward', async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!, { durations: DURATIONS.map((d, i) => (i === 1 ? null : d)) })
    await page.goto(`/read/${SLUG}`)
    await expect(headerPlay(page)).toBeVisible()
    await openChapter(page, 2)
    await headerPlay(page).click()
    await expectPlaying(page, 2)
    await trackButton(page, 'Previous')
    await expectPlaying(page, 0)
    await staysOn(page, 0)
    await expect(page.locator('article h2')).toContainText('Chapter 1:')
  })

  test('Previous with no narrated chapter before it keeps playing', async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!, { durations: DURATIONS.map((d, i) => (i === 0 ? null : d)) })
    await page.goto(`/read/${SLUG}`)
    await expect(headerPlay(page)).toBeVisible()
    await openChapter(page, 2)
    await headerPlay(page).click()
    await expectPlaying(page, 2)
    await trackButton(page, 'Previous')
    await expectPlaying(page, 1)
    await trackButton(page, 'Previous')
    await staysOn(page, 1)
  })

  test('playing past the last narrated chapter stops without jumping the reader', async ({ context, baseURL, page }) => {
    // Chapters 1 and 2 (3 s) narrated, the rest not yet
    await stubHuggingFace(context, baseURL!, { durations: DURATIONS.map((d, i) => (i <= SHORT_CH ? d : null)) })
    await page.goto(`/read/${SLUG}`)
    await expect(headerPlay(page)).toBeVisible()
    await openChapter(page, SHORT_CH)
    await headerPlay(page).click()
    await expectPlaying(page, SHORT_CH, 0)
    await expect(headerPlay(page)).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => (await audio(page))!.paused).toBe(true)
    await expect(bar(page)).toContainText(`Ch ${SHORT_CH + 1}/`)
    await expect(page.locator('article h2')).toContainText('Chapter 2:')

    // Play on a chapter after the last narrated one: nothing to play, the reader stays
    await openChapter(page, 5)
    await headerPlay(page).click()
    await page.waitForTimeout(1000)
    await expect(headerPlay(page)).toBeVisible()
    await expect(page.locator('article h2')).toContainText('Chapter 6:')
  })
})
