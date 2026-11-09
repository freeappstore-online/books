import {
  test, expect, stubHuggingFace, audio, bar, jumpOf, charPoint, chapterUrl, expectPlaying, headerPlay, marks,
  aiMentions, openChapter, trackButton, timings, alice, SLUG, SHORT_CH,
} from './fixtures'

const segs = timings(alice.chapters[0].content)

test.describe('playback', () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!)
    await page.goto(`/read/${SLUG}`)
    await expect(headerPlay(page)).toBeVisible()
  })

  test('Play streams chapter 1 with read-along, skip, seek bar and speed', async ({ page }) => {
    await headerPlay(page).click()
    await expectPlaying(page, 0, 1)
    await expect(page.locator('header').getByRole('button', { name: 'Pause' })).toHaveCount(1)

    await page.waitForSelector('[data-readalong="word"]')
    const first = await marks(page)
    expect(first.word).toBeTruthy()
    await expect.poll(async () => JSON.stringify(await marks(page)), { message: 'highlight moves' }).not.toBe(JSON.stringify(first))

    expect(await jumpOf(page, () => page.getByLabel('Forward 30 seconds').click())).toBeCloseTo(30, 0)
    expect(await jumpOf(page, () => page.getByLabel('Back 15 seconds').click())).toBeCloseTo(-15, 0)
    const slider = page.getByLabel('Position in chapter')
    const seeked = await jumpOf(page, async () => {
      await slider.focus()
      // Held down: ten steps of a second, committed when the key is released
      for (let i = 0; i < 10; i++) await page.keyboard.down('ArrowRight')
      await page.keyboard.up('ArrowRight')
    })
    // From the second the bar shows, which trails the audio by up to one (more on a busy machine)
    expect(seeked, 'seek bar moves the audio').toBeGreaterThan(7.5)
    expect(seeked).toBeLessThan(11)

    const speed = page.getByRole('button', { name: /^Speed / })
    await speed.click()
    await expect.poll(async () => (await audio(page))!.rate).toBe(1.25)
    expect((await audio(page))!.paused).toBe(false)
  })

  test('a word seeks while playing, pause keeps the position, a word starts playing while paused', async ({ page }) => {
    await headerPlay(page).click()
    await expectPlaying(page, 0)

    const target = segs[12]
    let pt = await charPoint(page, target[0] + 2)
    await page.mouse.click(pt.x, pt.y)
    await expect.poll(async () => Math.abs((await audio(page))!.t - target[2]), { message: 'seeks to the word' }).toBeLessThan(1.5)
    expect((await audio(page))!.paused).toBe(false)
    await expect.poll(async () => (await marks(page)).sentence).toBe(alice.chapters[0].content.slice(target[0], target[1]))

    const at = (await audio(page))!.t
    await bar(page).getByRole('button', { name: 'Pause' }).click()
    await expect.poll(async () => (await audio(page))!.paused).toBe(true)
    const saved = await page.evaluate(url => JSON.parse(localStorage.getItem('bp-prepared-positions')!)[url], chapterUrl(0))
    expect(Math.abs(saved - at)).toBeLessThan(3)

    const t2 = segs[20]
    pt = await charPoint(page, t2[0] + 2)
    await page.mouse.click(pt.x, pt.y)
    await expectPlaying(page, 0)
    await expect.poll(async () => Math.abs((await audio(page))!.t - t2[2]), { message: 'plays from the word' }).toBeLessThan(2)
  })

  test('the sleep timer counts down and turns off', async ({ page }) => {
    await headerPlay(page).click()
    await expectPlaying(page, 0)
    await page.getByRole('button', { name: 'Sleep timer' }).click()
    await page.getByRole('menuitemradio', { name: '5 minutes', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Sleep timer: 4:5\d$/ })).toBeVisible()
    await page.getByRole('button', { name: /^Sleep timer:/ }).click()
    await page.getByRole('menuitem', { name: 'Turn off timer' }).click()
    await expect(page.getByRole('button', { name: 'Sleep timer', exact: true })).toBeVisible()
  })

  test('next chapter, auto-advance with the reader following, sleep at end of chapter', async ({ page }) => {
    await headerPlay(page).click()
    await expectPlaying(page, 0)
    await trackButton(page, 'Next')
    await expectPlaying(page, SHORT_CH, 0)
    // The 3 s chapter ends and the next one starts by itself
    await expectPlaying(page, SHORT_CH + 1)
    await expect(page.locator('article h2')).toContainText('Chapter 3:')

    await bar(page).getByRole('button', { name: 'Show chapters' }).click()
    await bar(page).getByRole('button', { name: String(SHORT_CH + 1), exact: true }).click()
    await page.getByRole('button', { name: 'Sleep timer' }).click()
    await page.getByRole('menuitemradio', { name: 'End of chapter' }).click()
    await expect.poll(async () => (await audio(page))!.paused, { timeout: 10_000, message: 'stops at the end of the chapter' }).toBe(true)
    await expect(bar(page)).toContainText(`Ch ${SHORT_CH + 2}/`)
  })

  test('resume after reload continues at the saved time; My books shows it in progress', async ({ page }) => {
    await page.evaluate(url => localStorage.setItem('bp-prepared-positions', JSON.stringify({ [url]: 100 })), chapterUrl(0))
    await page.reload()
    await expect(headerPlay(page)).toBeVisible()
    await openChapter(page, 0)
    await headerPlay(page).click()
    await expectPlaying(page, 0, 95)
    expect((await audio(page))!.t).toBeLessThan(110)

    await page.goto('/library')
    const inProgress = page.locator('section', { hasText: 'In progress' })
    await expect(inProgress).toContainText('Alice')
    await expect(inProgress).toContainText('Resume')
    expect(await aiMentions(page)).toEqual([])
  })
})
