import { test, expect, stubHuggingFace, bar, expectPlaying, headerPlay, openChapter, trackButton, alice, SLUG } from './fixtures'
import type { Page } from '@playwright/test'

/** Go to another page of the app without a reload, so the player keeps its book. */
async function goToMyBooks(page: Page) {
  // Without scrolling to the link first, which would move the reading position
  await page.getByRole('link', { name: 'My books' }).first().dispatchEvent('click')
  await expect(page).toHaveURL(/\/library$/)
}

const heading = (page: Page) => page.locator('article h2')

test.describe('the reader opens where the reader left off (books#28)', () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!)
    await page.goto(`/read/${SLUG}`)
    await expect(headerPlay(page)).toBeVisible()
    await headerPlay(page).click()
    await expectPlaying(page, 0)
  })

  test('a bookmark in another chapter opens there, not on the chapter playing', async ({ page }) => {
    const at = 200
    await page.evaluate(([slug, at]) => {
      localStorage.setItem('bp-annotations', JSON.stringify({
        [slug]: [{ id: 'bm-1', kind: 'bookmark', chapterIdx: 5, start: at, end: at, text: 'A bookmark', created: 1 }],
      }))
      // As if made in another tab: the app picks it up without a reload
      window.dispatchEvent(new StorageEvent('storage', { key: 'bp-annotations' }))
    }, [SLUG, at] as const)
    await goToMyBooks(page)
    const notes = page.locator('section', { hasText: 'Bookmarks and notes' })
    await notes.locator('summary').click()
    await notes.getByRole('button', { name: 'Go to' }).click()
    await expect(heading(page)).toContainText(alice.chapters[5].title)
    // It keeps playing chapter 1
    await expectPlaying(page, 0, 1)
  })

  test('paused, a chapter read further on is where the book opens again', async ({ page }) => {
    await bar(page).getByRole('button', { name: 'Pause' }).click()
    await openChapter(page, 4)
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight / 2, behavior: 'instant' }))
    // The reading position is saved 300 ms after scrolling stops
    await page.waitForTimeout(600)
    const scrolled = await page.evaluate(() => scrollY)
    await goToMyBooks(page)
    await page.getByRole('link', { name: 'Resume' }).click()
    await expect(heading(page)).toContainText(alice.chapters[4].title)
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrolled * 0.8)
  })

  test('listened further from another page, then reloaded: the book opens on that chapter', async ({ page }) => {
    await goToMyBooks(page)
    await trackButton(page, 'Next')
    await trackButton(page, 'Next')
    await expectPlaying(page, 2)
    await bar(page).getByRole('button', { name: 'Pause' }).click()
    // Also after a reload, when the player no longer holds the book
    await page.reload()
    await page.getByRole('link', { name: 'Resume' }).click()
    await expect(heading(page)).toContainText(alice.chapters[2].title)
  })
})
