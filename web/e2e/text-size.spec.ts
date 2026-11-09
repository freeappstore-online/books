import { test, expect, stubHuggingFace, SLUG } from './fixtures'

test('book text size and interface text size change separately and are kept', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  await page.goto(`/read/${SLUG}`)
  const text = page.locator('div[title="Click to start listening from here"]')
  await expect(text).toBeVisible()
  const bookSize = () => text.evaluate(el => getComputedStyle(el).fontSize)
  const rootSize = () => page.evaluate(() => document.documentElement.style.fontSize)
  expect(await bookSize()).toBe('17px')

  await page.getByRole('button', { name: 'Text size' }).click()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Larger book text size' }).click()
  expect(await bookSize()).toBe('20px')
  expect(['', '100%']).toContain(await rootSize())

  await page.getByRole('button', { name: 'Larger interface text size' }).click()
  await page.getByRole('button', { name: 'Larger interface text size' }).click()
  expect(await rootSize()).toBe('110%')
  expect(await bookSize()).toBe('20px')

  await page.reload()
  await expect(text).toBeVisible()
  expect(await bookSize()).toBe('20px')
  expect(await rootSize()).toBe('110%')

  await page.goto('/settings')
  await expect(page.getByRole('slider', { name: 'Book text size' })).toHaveValue('20')
  await expect(page.getByRole('slider', { name: 'Interface text size' })).toHaveValue('110')
})
