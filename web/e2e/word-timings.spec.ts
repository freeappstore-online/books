import { test, expect, stubHuggingFace, HF, SLUG, alice, headerPlay, expectPlaying, audio, charPoint } from './fixtures'

test('published word timestamps drive highlighting and tap-to-seek', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  await context.route(`**/catalog/${SLUG}.json`, route => route.fulfill({ json: {
    chapters: alice.chapters.map((c, i) => i === 0 ? { title: c.title, content: 'Slow words. Next.' } : c),
  } }))
  await context.route(`${HF}af_heart/${SLUG}/0.timings.json`, route => route.fulfill({ json: {
    v: 1, segments: [[0, 11, 0, 90], [12, 17, 100, 110]],
    words: [[0, 4, 0, 70], [5, 11, 80, 88], [12, 17, 102, 109]],
  }, headers: { 'access-control-allow-origin': '*' } }))
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0)
  const word = page.locator('[data-readalong="word"]')
  await expect(word).toHaveText('Slow')
  // At 60 s the sentence estimate would already show "words.", but the measured
  // first word still lasts until 70 s.
  await page.evaluate(() => { (window as unknown as { __audios: HTMLAudioElement[] }).__audios[0].currentTime = 60 })
  await expect.poll(async () => (await audio(page))!.t).toBeGreaterThan(60.1)
  await expect(word).toHaveText('Slow')
  const p = await charPoint(page, 7)
  await page.mouse.click(p.x, p.y)
  await expect.poll(async () => (await audio(page))!.t).toBeGreaterThanOrEqual(80)
  expect((await audio(page))!.t).toBeLessThan(83)
  await expect(word).toHaveText('words.')
})
