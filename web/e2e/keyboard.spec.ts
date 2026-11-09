// Keyboard-only use (books#15): shortcuts, focus rings, menus and dialogs.
// Desktop engines only: phones have no keyboard shortcuts.
import {
  test, expect, stubHuggingFace, audio, axeViolations, bar, chapterOf, expectPlaying, headerPlay, jumpOf, selectText, SLUG,
} from './fixtures'
import type { Page } from '@playwright/test'

test.skip(({ browserName }) => browserName === 'webkit', 'desktop keyboard: Chromium and Firefox')

const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement
  return {
    tag: el.tagName,
    label: el.getAttribute('aria-label') || el.textContent!.trim().slice(0, 40),
    outline: getComputedStyle(el).outlineStyle,
    shortcut: el.dataset.shortcut,
  }
})
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

/** Tab forward until the focused element's label matches. */
async function tabTo(page: Page, re: RegExp, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const f = await focused(page)
    if (re.test(f.label)) return f
  }
  return null
}

test.beforeEach(async ({ context, baseURL }) => {
  await stubHuggingFace(context, baseURL!)
})

test('catalogue: first Tab has a focus ring, "/" searches and typing stays in the field', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('text=Audiobooks')
  await page.keyboard.press('Tab')
  const f = await focused(page)
  expect(f.tag).toBe('A')
  expect(f.outline).not.toBe('none')
  await page.keyboard.press('/')
  expect((await focused(page)).shortcut).toBe('search')
  await page.keyboard.type('a/k ')
  await expect(page.locator('[data-shortcut="search"]')).toHaveValue('a/k ')
})

test('reader: Space, K, arrows, [ ], Shift+arrows control the narration', async ({ page }) => {
  await page.goto(`/read/${SLUG}`)
  await expect(headerPlay(page)).toBeVisible()
  await blur(page)
  await page.keyboard.press(' ')
  await expectPlaying(page, 0, 1)

  await page.keyboard.press('k')
  await expect.poll(async () => (await audio(page))!.paused, { message: 'K pauses' }).toBe(true)
  await page.keyboard.press('k')
  await expectPlaying(page, 0)

  expect(await jumpOf(page, () => page.keyboard.press('ArrowRight')), '→ forward 30 s').toBeCloseTo(30, 0)
  expect(await jumpOf(page, () => page.keyboard.press('ArrowLeft')), '← back 15 s').toBeCloseTo(-15, 0)

  await page.keyboard.press(']')
  await expect.poll(async () => (await audio(page))!.rate, { message: '] faster' }).toBe(1.1)
  await page.keyboard.press('[')
  await page.keyboard.press('[')
  await expect.poll(async () => (await audio(page))!.rate, { message: '[ slower' }).toBe(0.9)
  await page.keyboard.press(']')

  await expect(page.getByLabel('Position in chapter')).toHaveAttribute('aria-valuetext', /^\d+:\d\d of \d+:\d\d$/)
  await expect(page.locator('aside button[aria-current="true"]')).toHaveCount(1)

  await page.keyboard.press('Shift+ArrowRight')
  await expectPlaying(page, 1, 0)
  await expect(page.locator('article h2')).toContainText('Chapter 2:')
  await page.keyboard.press('Shift+ArrowLeft')
  await expectPlaying(page, 0, 0)
})

test('reader: F follows the audio again; Space on a focused button only activates it', async ({ page }) => {
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0)
  await page.waitForSelector('[data-readalong="word"]')

  await page.mouse.move(600, 400)
  await page.mouse.wheel(0, 3000)
  await expect(page.locator('[data-shortcut="follow"]')).toHaveCount(1)
  await blur(page)
  await page.keyboard.press('f')
  await expect(page.locator('[data-shortcut="follow"]')).toHaveCount(0)
  await expect(page.locator('[aria-live] [data-readalong], [data-readalong][aria-live]')).toHaveCount(0)

  await bar(page).getByRole('button', { name: 'Show chapters' }).focus()
  await page.keyboard.press(' ')
  await expect(bar(page).getByRole('button', { name: 'Hide chapters' })).toHaveAttribute('aria-expanded', 'true')
  expect((await audio(page))!.paused).toBe(false)
  await expect(page.locator('#player-panel button[aria-current="true"]')).toHaveCount(1)
})

test('menus and panels: open with focus inside, arrows move, Escape returns focus', async ({ page }) => {
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0)

  await blur(page)
  const sleep = await tabTo(page, /^Sleep timer$/)
  expect(sleep, 'Tab reaches the player').not.toBeNull()
  expect(sleep!.outline).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toHaveCount(1)
  const first = await focused(page)
  expect(first.label).toMatch(/minutes|chapter/i)
  await expect(page.getByRole('button', { name: 'Sleep timer' })).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowDown')
  expect((await focused(page)).label).not.toBe(first.label)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect((await focused(page)).label).toBe('Sleep timer')

  await page.getByRole('button', { name: 'Text size' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#text-size-panel')).toHaveCount(1)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  await expect(page.locator('#text-size-panel')).toHaveCount(0)
  expect((await focused(page)).label).toBe('Text size')
})

test('"?" opens the shortcuts help: axe clean, focus kept inside, Escape closes', async ({ page }) => {
  await page.goto(`/read/${SLUG}`)
  await expect(headerPlay(page)).toBeVisible()
  await blur(page)
  await page.keyboard.press('?')
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  expect(await axeViolations(page)).toEqual([])
  expect((await focused(page)).label).toBe('Close')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

test('reading-only book: Space plays nothing, "/" opens the in-book search', async ({ page }) => {
  await page.goto('/read/dracula')
  await page.waitForSelector('article h2')
  await page.waitForLoadState('networkidle')
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: /play/i })).toHaveCount(0)
  expect(chapterOf(await audio(page))).toBe(-1)
  await page.keyboard.press('/')
  expect((await focused(page)).label).toBe('Search in this book')
  await page.keyboard.type('k ')
  await expect(page.locator('#reader-search')).toHaveValue('k ')
})

test('Space scrolls the page where there is nothing to play (books#26)', async ({ page }) => {
  for (const path of ['/', '/read/dracula']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await blur(page)
    await page.keyboard.press(' ')
    await expect.poll(() => page.evaluate(() => window.scrollY), { message: `${path}: Space scrolls` }).toBeGreaterThan(0)
  }
})

test('shortcuts leave the highlight toolbar and editor alone (books#26)', async ({ page }) => {
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0)

  // The highlight toolbar: keys pressed on its buttons are not shortcuts
  await selectText(page, 5000, 5010)
  const toolbar = page.getByRole('toolbar', { name: 'Highlight' })
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole('button').first().focus()
  for (const key of ['k', '?', '/']) await page.keyboard.press(key)
  expect((await audio(page))!.paused, 'k on the toolbar does not pause').toBe(false)
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('#reader-search')).toHaveCount(0)

  // The highlight editor (a div role=dialog): arrows, k, ? and / are its own
  await toolbar.getByRole('button', { name: 'Note' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit highlight' })
  await expect(editor).toBeVisible()
  await editor.getByRole('radio', { name: 'Green' }).focus()
  const t = (await audio(page))!.t
  for (const key of ['ArrowRight', 'k', '?', '/']) await page.keyboard.press(key)
  const a = (await audio(page))!
  expect(a.paused, 'k in the editor does not pause').toBe(false)
  expect(a.t - t, '→ in the editor does not skip 30 s').toBeLessThan(5)
  await expect(page.locator('dialog[open]'), '? opens no second modal').toHaveCount(0)
  await expect(page.locator('#reader-search'), '/ opens no search behind it').toHaveCount(0)
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('no smooth scroll, animations off', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Audiobooks')
    const r = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'animate-pulse'
      document.body.append(el)
      return { scroll: getComputedStyle(document.documentElement).scrollBehavior, anim: parseFloat(getComputedStyle(el).animationDuration) }
    })
    expect(r.scroll).toBe('auto')
    expect(r.anim).toBeLessThan(0.01)
  })
})

test('saving offline is announced in a status region', async ({ context, baseURL, page }) => {
  await context.unrouteAll()
  await stubHuggingFace(context, baseURL!, { inline: true })
  await page.goto(`/read/${SLUG}`)
  await page.waitForSelector('article h2')
  await page.getByRole('button', { name: /Save offline/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('header [role="status"]')).toHaveText('Saved for offline')
})
