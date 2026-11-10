import { readFileSync } from 'node:fs'
import { test, expect, stubHuggingFace } from './fixtures'

const book = JSON.parse(readFileSync(new URL('../../edition/texts/a-little-princess.json', import.meta.url), 'utf8'))

test.beforeEach(async ({ context, baseURL }) => {
  await stubHuggingFace(context, baseURL!)
})

test.describe('desktop chapter list', () => {
  test.use({ viewport: { width: 1280, height: 844 } })

  test('collapsing gives the reader more room and is remembered after reopening', async ({ page }) => {
    await page.goto('/read/a-little-princess/')
    const sidebar = page.locator('#desktop-chapters')
    await expect(sidebar).toBeVisible()
    const before = (await page.locator('main').boundingBox())!.width
    const hide = page.locator('header').getByRole('button', { name: 'Hide chapters', exact: true })
    await hide.focus()
    await page.keyboard.press('Space')
    await expect(sidebar).toBeHidden()
    const show = page.locator('header').getByRole('button', { name: 'Show chapters', exact: true })
    await expect(show).toHaveAttribute('aria-expanded', 'false')
    expect((await page.locator('main').boundingBox())!.width).toBeGreaterThan(before + 150)
    await page.reload()
    await expect(show).toBeVisible()
    await expect(sidebar).toBeHidden()
    await show.click()
    await expect(sidebar).toBeVisible()
    await expect(page.locator('article h2')).toHaveText(book.chapters[0].title)
  })

  test('compact labels wrap long titles and still open the correct full chapter', async ({ page }) => {
    await page.goto('/read/a-little-princess/')
    const sidebar = page.locator('#desktop-chapters')
    await expect(sidebar.getByRole('button', { name: book.chapters[10].title, exact: true })).toHaveText('11: Ram Dass')
    const long = sidebar.getByRole('button', { name: book.chapters[13].title, exact: true })
    await expect(long).toHaveText('14: What Melchisedec Heard and Saw')
    const lines = await long.locator('span').evaluate(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }))
    expect(lines.height).toBeGreaterThan(lines.line + 1)
    await long.click()
    await expect(page.locator('article h2')).toHaveText(book.chapters[13].title)
    await expect(long).toHaveAttribute('aria-current', 'true')
    expect(await page.evaluate(() => scrollY)).toBe(0)
  })

  test('a preface does not renumber the original chapters', async ({ page }) => {
    await page.goto('/read/a-christmas-carol/')
    const sidebar = page.locator('#desktop-chapters')
    await expect(sidebar.getByRole('button', { name: 'Preface', exact: true })).toHaveText('Preface')
    await expect(sidebar.getByRole('button', { name: "Stave 1: Marley's Ghost", exact: true })).toHaveText("Stave 1: Marley's Ghost")
  })
})

test.describe('mobile chapter drawer', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('long labels wrap at large interface size and selecting a chapter closes the drawer', async ({ context, page }) => {
    await context.addInitScript(() => localStorage.setItem('bp-ui-scale', '150'))
    await page.goto('/read/a-little-princess/')
    await page.locator('header').getByRole('button', { name: /^Chapters: chapter / }).click()
    const drawer = page.locator('#chapter-drawer')
    const long = drawer.getByRole('button', { name: book.chapters[13].title, exact: true })
    await expect(long).toHaveText('14: What Melchisedec Heard and Saw')
    const lines = await long.locator('span').evaluate(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }))
    expect(lines.height).toBeGreaterThan(lines.line + 1)
    await long.click()
    await expect(drawer).toBeHidden()
    await expect(page.locator('article h2')).toHaveText(book.chapters[13].title)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
