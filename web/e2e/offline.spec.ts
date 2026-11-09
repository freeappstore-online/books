import { test, expect, stubHuggingFace, audio, headerPlay, marks, alice, openReaderMore, SLUG } from './fixtures'

// Playwright routes service worker requests in Chromium only; elsewhere the page saves and plays without one
test.use({ serviceWorkers: async ({ browserName }, use) => use(browserName === 'chromium' ? 'allow' : 'block') })

test('save offline, then play from the saved copy with no network', async ({ context, baseURL, page, browserName }) => {
  const hf = await stubHuggingFace(context, baseURL!, { inline: true })
  if (browserName === 'chromium') {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)
  }
  await page.goto(`/read/${SLUG}`)
  await page.waitForSelector('article h2')
  await openReaderMore(page)
  await page.getByRole('button', { name: /Save offline/ }).click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 30_000 })
  expect(hf.requests.filter(p => p.endsWith('.m4a'))).toHaveLength(alice.chapters.length)

  await context.setOffline(true)
  hf.offline = true
  hf.requests.length = 0
  // Reload from the service worker; elsewhere the loaded page stays
  if (browserName === 'chromium') {
    await page.reload()
    await page.waitForSelector('article h2')
  }
  await headerPlay(page).click()
  await expect.poll(async () => (await audio(page))?.t ?? 0, { message: 'plays offline' }).toBeGreaterThan(0.5)
  expect((await audio(page))!.src).toMatch(/^blob:/)
  expect(hf.requests.filter(p => p !== 'manifest.json')).toEqual([])
  await page.waitForSelector('[data-readalong="word"]')
  expect((await marks(page)).word).toBeTruthy()
})
