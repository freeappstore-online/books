import { test, expect, stubHuggingFace, alice, SLUG, headerPlay, expectPlaying, openChapter, bar } from './fixtures'

const chapters = alice.chapters.map((c, i) => ({ ...c, title: i === 0 ? 'Preface' : i === 1 ? 'A Word of Explanation' : `Chapter ${i - 1}` }))

test.beforeEach(async ({ context, baseURL }) => {
  await stubHuggingFace(context, baseURL!)
  // Keep the narrated fixture's content/timings while giving it two introductory sections.
  await context.route(`**/catalog/${SLUG}.json`, route => route.fulfill({ json: { chapters } }))
})

test('skip preface persists, opens Chapter 1 and preserves later reading progress', async ({ page }) => {
  const heading = page.locator('article h2')
  await page.goto(`/read/${SLUG}`)
  await expect(heading).toHaveText('Preface')
  await page.goto('/settings')
  const toggle = page.getByRole('switch', { name: 'Skip preface', exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await page.reload()
  await expect(toggle).toBeChecked()
  await page.goto(`/read/${SLUG}`)
  await expect(heading).toHaveText('Chapter 1')
  await openChapter(page, 4, { chapters })
  await expect(heading).toHaveText('Chapter 3')
  await page.reload()
  await expect(heading).toHaveText('Chapter 3')
  await page.goto('/settings')
  await toggle.uncheck()
  await page.goto(`/read/${SLUG}?ch=0`)
  await expect(heading).toHaveText('Preface')
  await page.reload()
  await page.goto(`/read/${SLUG}`)
  await expect(heading).toHaveText('Preface')
})


test('skip preface applies to listening while explicit preface links still play', async ({ page }) => {
  const heading = page.locator('article h2')
  await page.goto('/settings')
  await page.getByRole('switch', { name: 'Skip preface', exact: true }).check()
  await page.goto(`/read/${SLUG}`)
  await expect(heading).toHaveText('Chapter 1')
  await headerPlay(page).click()
  await expectPlaying(page, 2)
  await expect(page.locator('[data-readalong="word"]').first()).toBeVisible()
  // Bookmarks/deep links can still open and play the preface.
  await page.goto(`/read/${SLUG}?ch=0&at=0`)
  await expect(heading).toHaveText('Preface')
  await headerPlay(page).click()
  await expectPlaying(page, 0)
  await bar(page).getByRole('button', { name: 'Pause', exact: true }).click()
  // Listening from the library uses the same starting rule as opening the reader.
  await page.goto('/library')
  await page.getByRole('button', { name: 'Listen', exact: true }).first().click()
  await expectPlaying(page, 2)
  await expect(heading).toHaveText('Chapter 1')
})
