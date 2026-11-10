// Accessibility (books#15): axe-core finds nothing on every page, playing and
// with menus open, in light and dark. Desktop engines only; see keyboard.spec.ts.
import { test, expect, stubHuggingFace, axeViolations, bar, headerPlay, SLUG } from './fixtures'
import type { Page } from '@playwright/test'

test.skip(({ browserName }) => browserName === 'webkit', 'desktop keyboard and layout: Chromium and Firefox')

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })

    test.beforeEach(async ({ context, baseURL }) => {
      await stubHuggingFace(context, baseURL!)
      await context.addInitScript(t => { try { localStorage.setItem('stores-theme', t) } catch {} }, theme)
    })

    const clean = async (page: Page, where: string) => {
      await page.waitForLoadState('networkidle')
      expect(await axeViolations(page), where).toEqual([])
    }

    test('catalogue, My books and Settings', async ({ page }) => {
      await page.goto('/')
      await page.waitForSelector('text=Audiobooks')
      await clean(page, 'catalogue')
      await page.goto('/library')
      await page.waitForSelector('text=Saved on this device')
      await clean(page, 'my books')
      await page.goto('/settings')
      await page.waitForSelector('text=Listening')
      await clean(page, 'settings')
    })

    test('reader playing, with the chapter list and a menu open', async ({ page }) => {
      await page.goto(`/read/${SLUG}`)
      await headerPlay(page).click()
      await page.waitForSelector('[data-readalong="word"]')
      await clean(page, 'reader playing')
      await bar(page).getByRole('button', { name: 'Show chapters' }).click()
      // The Recent list labels the playing book's dot, as the reader's chapter lists do (books#35)
      await page.getByRole('button', { name: /^Recent/ }).click()
      await expect(page.locator('#player-panel').getByRole('img', { name: 'Playing' })).toBeVisible()
      await page.getByRole('button', { name: /^Chapters/ }).click()
      await page.getByRole('button', { name: 'Sleep timer' }).click()
      await expect(page.getByRole('menu')).toBeVisible()
      await clean(page, 'reader menus open')
    })

    test('reading-only book, and its in-book search', async ({ page }) => {
      await page.goto('/read/dracula')
      await page.waitForSelector('article h2')
      await clean(page, 'reader dracula')
      await page.keyboard.press('/')
      await page.keyboard.type('the count')
      await expect(page.locator('#reader-search')).toHaveValue('the count')
      await clean(page, 'reader dracula search')
    })
  })
}
