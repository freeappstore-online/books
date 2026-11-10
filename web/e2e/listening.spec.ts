import {
  test, expect, stubHuggingFace, audio, bar, chapterOf, expectPlaying, headerPlay, marks, openChapter, openReaderMore,
  trackButton, alice, SLUG, SHORT_CH, PARTIAL, partial,
} from './fixtures'
import type { Page } from '@playwright/test'

// Listening settings (books#37): chapter titles, pause between chapters, continue, volume boost

type LogEntry = { type: string; src: string; at: number }
const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: LogEntry[] }).__log)

/** Every chapter has a 2 s spoken title, and timings */
const TITLES = { [SLUG]: { timings: true, titles: alice.chapters.map(() => 2) } }
const isTitle = (src: string, idx: number) => src.endsWith(`/${SLUG}/${idx}.title.m4a`)

async function expectTitlePlaying(page: Page, idx: number) {
  await expect.poll(async () => {
    const a = await audio(page)
    return !!a && !a.paused && isTitle(a.src, idx)
  }, { timeout: 15_000, message: `chapter ${idx + 1}'s title playing` }).toBe(true)
}

/** Settings → Listening */
async function settings(page: Page) {
  await page.goto('/settings')
  return page.locator('div', { has: page.getByRole('heading', { name: 'Listening' }) }).last()
}

/** Seconds from the end of chapter `from` to the start of chapter `to`, from the element's log. */
async function gap(page: Page, from: number, to: number): Promise<number> {
  const entries = await log(page)
  const ended = entries.find(e => e.type === 'ended' && chapterOf({ src: e.src, t: 0, paused: false, rate: 1 }) === from)!
  const started = entries.find(e => e.type === 'playing' && e.at > ended.at && chapterOf({ src: e.src, t: 0, paused: false, rate: 1 }) === to)!
  return (started.at - ended.at) / 1000
}

test.describe('chapter titles', () => {
  test('a chapter started from its beginning plays its title first; the bar and read-along wait for the chapter', async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!, { extras: TITLES })
    await page.goto(`/read/${SLUG}`)
    await headerPlay(page).click()
    await expectTitlePlaying(page, 0)
    // The seek bar shows the chapter, at its start; no highlight yet
    await expect(page.getByLabel('Position in chapter')).toHaveAttribute('aria-valuetext', '0:00 of 5:00')
    expect((await marks(page)).word).toBeNull()
    // Then the chapter, with read-along
    await expectPlaying(page, 0, 1)
    await page.waitForSelector('[data-readalong="word"]')

    // Resumed mid-chapter: no title
    await bar(page).getByRole('button', { name: 'Pause' }).click()
    await bar(page).getByRole('button', { name: 'Resume' }).click()
    await expectPlaying(page, 0, 1.2)
    // Next chapter, from its start: its title first
    await trackButton(page, 'Next')
    await expectTitlePlaying(page, SHORT_CH)
    await expectPlaying(page, SHORT_CH, 0)
    // Auto-advance too
    await expectTitlePlaying(page, SHORT_CH + 1)
    await expectPlaying(page, SHORT_CH + 1)
    const titles = (await log(page)).filter(e => e.type === 'playing' && /\.title\.m4a$/.test(e.src)).map(e => e.src.split('/').at(-1))
    expect(titles).toEqual(['0.title.m4a', '1.title.m4a', '2.title.m4a'])
  })

  test('seeking during the title goes to the chapter, from there', async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!, { extras: TITLES })
    await page.goto(`/read/${SLUG}`)
    await headerPlay(page).click()
    await expectTitlePlaying(page, 0)
    await page.getByLabel('Forward 30 seconds').click()
    await expectPlaying(page, 0, 29)
    expect((await audio(page))!.t).toBeLessThan(33)
  })

  test('off in Settings: no titles', async ({ context, baseURL, page }) => {
    const hf = await stubHuggingFace(context, baseURL!, { extras: TITLES })
    const listening = await settings(page)
    const toggle = listening.getByRole('switch', { name: 'Read chapter titles' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await page.goto(`/read/${SLUG}`)
    await headerPlay(page).click()
    await expectPlaying(page, 0, 1)
    expect(hf.requests.filter(p => p.endsWith('.title.m4a'))).toEqual([])
  })

  test('saved offline with the book, and counted in the size', async ({ context, baseURL, page }) => {
    // Partial book: 603 s of narration plus three 10 s titles (unnarrated chapters' titles aren't saved)
    const hf = await stubHuggingFace(context, baseURL!, {
      partial: true, inline: true, extras: { [PARTIAL]: { titles: partial.chapters.map(() => 10) } },
    })
    await page.goto(`/read/${PARTIAL}`)
    await page.waitForSelector('article h2')
    await openReaderMore(page)
    const save = page.getByRole('button', { name: /Save offline/ })
    // 633 s at 5,200 bytes a second, not 3.0 MB
    await expect(save).toHaveAttribute('title', /\(~3\.1 MB\)/)
    await save.click()
    await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 30_000 })
    const last = partial.chapters.length - 1
    const files = await page.evaluate(slug => Object.keys(JSON.parse(localStorage.getItem('bp-offline-books')!)[slug].files), PARTIAL)
    expect(files.filter(f => f.endsWith('.title.m4a')).map(f => f.split('/').at(-1)).sort()).toEqual([`0.title.m4a`, `1.title.m4a`, `${last}.title.m4a`].sort())
    // The manifest says this book has no timings: none asked for
    expect(hf.requests.filter(p => p.endsWith('.timings.json'))).toEqual([])
  })
})

test.describe('between chapters', () => {
  test('default: a 1.5 s pause on auto-advance only, not on Next', async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!)
    await page.goto(`/read/${SLUG}`)
    await page.waitForSelector('article h2')
    await openChapter(page, SHORT_CH)
    await headerPlay(page).click()
    await expectPlaying(page, SHORT_CH + 1)
    const g = await gap(page, SHORT_CH, SHORT_CH + 1)
    expect(g).toBeGreaterThan(1.4)
    expect(g).toBeLessThan(4)
    expect((await log(page)).some(e => e.type === 'ended' && e.src.endsWith('/silence.wav#t=3.5'))).toBe(true)

    // Next is a jump, not an end: no pause
    const before = (await log(page)).length
    await trackButton(page, 'Next')
    await expectPlaying(page, SHORT_CH + 2)
    expect((await log(page)).slice(before).some(e => e.src.includes('#t='))).toBe(false)
  })

  for (const [label, seconds] of [['3 s', 3], ['Off', 0]] as const) {
    test(`pause set to ${label}`, async ({ context, baseURL, page }) => {
      await stubHuggingFace(context, baseURL!)
      const listening = await settings(page)
      const group = listening.getByRole('group', { name: 'Pause between chapters' })
      await expect(group.getByRole('button', { name: '1.5 s' })).toHaveAttribute('aria-pressed', 'true')
      await group.getByRole('button', { name: label }).click()
      await expect(group.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
      await page.goto(`/read/${SLUG}`)
      await page.waitForSelector('article h2')
      await openChapter(page, SHORT_CH)
      await headerPlay(page).click()
      await expectPlaying(page, SHORT_CH + 1)
      const g = await gap(page, SHORT_CH, SHORT_CH + 1)
      if (seconds) {
        expect(g).toBeGreaterThan(seconds - 0.1)
        expect(g).toBeLessThan(seconds + 2.5)
      } else {
        expect(g).toBeLessThan(1.4)
      }
    })
  }

  test('continue off: stops at the end of the chapter, ready to start the next', async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!)
    const listening = await settings(page)
    await listening.getByRole('switch', { name: 'Continue to the next chapter' }).click()
    await page.goto(`/read/${SLUG}`)
    await page.waitForSelector('article h2')
    await openChapter(page, SHORT_CH)
    await headerPlay(page).click()
    await expectPlaying(page, SHORT_CH, 0)
    await expect(bar(page).getByRole('button', { name: 'Resume' })).toBeVisible({ timeout: 10_000 })
    await expect(bar(page)).toContainText(`Ch ${SHORT_CH + 2}/${alice.chapters.length}`)
    expect(await page.evaluate(slug => JSON.parse(localStorage.getItem('bp-audio-position')!)[slug], SLUG)).toBe(SHORT_CH + 1)
    await page.waitForTimeout(1000)
    expect((await audio(page))!.paused).toBe(true)
    // Resume starts the next chapter
    await bar(page).getByRole('button', { name: 'Resume' }).click()
    await expectPlaying(page, SHORT_CH + 1)
  })

  test('plays through the whole book, past unnarrated chapters, then stops', async ({ context, baseURL, page }) => {
    // Chapters 2, 4, 5 and 12 narrated (2 s each), with titles and the default pause
    const last = alice.chapters.length - 1
    const durations = alice.chapters.map((_, i) => ([1, 3, 4, last].includes(i) ? 2 : null))
    await stubHuggingFace(context, baseURL!, { durations, extras: { [SLUG]: { titles: durations.map(d => d && 1) } } })
    await page.goto(`/read/${SLUG}`)
    await page.waitForSelector('article h2')
    await openChapter(page, 1)
    await headerPlay(page).click()
    await expect(bar(page).getByRole('button', { name: 'Resume' })).toBeVisible({ timeout: 40_000 })
    const played = (await log(page)).filter(e => e.type === 'ended').map(e => e.src.split('/').at(-1))
    expect(played).toEqual([
      '1.title.m4a', '1.m4a',
      'silence.wav#t=3.5', '3.title.m4a', '3.m4a',
      'silence.wav#t=3.5', '4.title.m4a', '4.m4a',
      'silence.wav#t=3.5', `${last}.title.m4a`, `${last}.m4a`,
    ])
    await expect(bar(page)).toContainText(`Ch ${last + 1}/${alice.chapters.length}`)
  })
})

test.describe('volume boost', () => {
  test('not offered on iPhone and iPad, where locking the screen would silence it', async ({ context, baseURL, page, isMobile, browserName }) => {
    test.skip(!(isMobile && browserName === 'webkit'), 'iOS only')
    await stubHuggingFace(context, baseURL!)
    const listening = await settings(page)
    await expect(listening.getByRole('switch', { name: 'Continue to the next chapter' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Volume boost' })).toHaveCount(0)
  })

  test('off: no Web Audio; on: plays through it, louder, from the next Play or at once', async ({ context, baseURL, page, browserName, isMobile }) => {
    test.skip(isMobile && browserName === 'webkit', 'not offered on iOS')
    await stubHuggingFace(context, baseURL!, { tone: true })
    const ctxs = () => page.evaluate(() => (window as unknown as { __ctxs: AudioContext[] }).__ctxs.map(c => c.state))
    /** Loudest sample the element sends into Web Audio (all zeros if loaded without CORS) */
    const level = () => page.evaluate(async () => {
      const ctx = (window as unknown as { __ctxs: AudioContext[] }).__ctxs[0]
      const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios[0]
      const src = (a as unknown as { __src?: MediaElementAudioSourceNode }).__src
      if (!src) return -1
      const an = ctx.createAnalyser()
      src.connect(an)
      const data = new Float32Array(an.fftSize)
      let max = 0
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 50))
        an.getFloatTimeDomainData(data)
        for (const v of data) max = Math.max(max, Math.abs(v))
      }
      src.disconnect(an)
      return max
    })
    // Keep the app's source and gain nodes to listen and look at them
    await page.addInitScript(() => {
      const create = AudioContext.prototype.createMediaElementSource
      AudioContext.prototype.createMediaElementSource = function (el) {
        const node = create.call(this, el)
        ;(el as unknown as { __src: MediaElementAudioSourceNode }).__src = node
        return node
      }
      const createGain = AudioContext.prototype.createGain
      AudioContext.prototype.createGain = function () {
        const node = createGain.call(this)
        ;(window as unknown as { __gain: GainNode }).__gain = node
        return node
      }
    })
    const gain = () => page.evaluate(() => (window as unknown as { __gain: GainNode }).__gain.gain.value)

    // Playing without the boost makes no AudioContext
    await page.goto(`/read/${SLUG}`)
    await headerPlay(page).click()
    await expectPlaying(page, 0, 1)
    expect(await ctxs()).toEqual([])

    // Turned on while playing (the player's Listening panel): the chapter starts again through Web Audio
    await bar(page).getByRole('button', { name: 'Show chapters' }).click()
    await bar(page).getByRole('button', { name: 'Listening' }).click()
    const toggle = bar(page).getByRole('switch', { name: 'Volume boost' })
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect.poll(ctxs).toEqual(['running'])
    expect(await page.evaluate(() => (window as unknown as { __audios: HTMLAudioElement[] }).__audios[0].crossOrigin)).toBe('anonymous')
    await expectPlaying(page, 0, 2)
    // Heard through Web Audio, at twice the gain
    expect(await level()).toBeGreaterThan(0.05)
    expect(await gain()).toBe(2)

    // After a reload, the AudioContext waits for the Play click
    await page.reload()
    await expect(headerPlay(page)).toBeVisible()
    expect(await ctxs()).toEqual([])
    await headerPlay(page).click()
    await expectPlaying(page, 0, 3)
    await expect.poll(ctxs).toEqual(['running'])
    expect(await level()).toBeGreaterThan(0.05)
    expect(await gain()).toBe(2)

    // Off again: same graph, normal level
    await bar(page).getByRole('button', { name: 'Show chapters' }).click()
    await bar(page).getByRole('button', { name: 'Listening' }).click()
    await bar(page).getByRole('switch', { name: 'Volume boost' }).click()
    expect(await gain()).toBe(1)
    await page.waitForTimeout(500)
    expect((await audio(page))!.paused).toBe(false)
  })
})
