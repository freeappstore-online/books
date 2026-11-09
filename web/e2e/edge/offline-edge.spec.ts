// Offline and app-update edge cases (books#24), in Chromium with the real
// service worker, against e2e/edge/server.ts (project "edge" in playwright.config.ts).
// Serial: the server's build and slow stream are shared.
import { test, expect, stubHuggingFace, audio, bar, headerPlay, alice, SLUG, type HfStub } from '../fixtures'
import type { BrowserContext, Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const N = alice.chapters.length
const narrated = (n = N) => alice.chapters.map((_, i) => (i < n ? 300 : null))

const control = (baseURL: string, query: string) => fetch(`${baseURL}/__e2e?${query}`)
const cacheKeys = (page: Page) => page.evaluate(async () => (await (await caches.open('books-offline-v1')).keys()).map(r => r.url))
const savedIndex = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bp-offline-books') || '{}'))
const m4as = (hf: HfStub) => hf.requests.filter(p => p.endsWith('.m4a'))

async function setOffline(context: BrowserContext, hf: HfStub, offline: boolean) {
  hf.offline = offline
  await context.setOffline(offline)
}
async function swReady(page: Page) {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}
async function openReader(page: Page) {
  await page.goto(`/read/${SLUG}`)
  await page.waitForSelector('article h2')
}
async function saveAlice(page: Page) {
  await page.getByRole('button', { name: /Save offline/ }).click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 30_000 })
}
const savingStarted = (page: Page) =>
  page.waitForFunction(() => /Saving [1-9]/.test(document.querySelector('header')!.innerText), null, { timeout: 10_000 })

test.beforeEach(async ({ baseURL }) => {
  await control(baseURL!, 'build=a&slow=1')
})

test('offline: unsaved books are reading-only, saved chapters play, reconnecting needs no reload', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { inline: true, durations: narrated() })
  await swReady(page)
  await openReader(page)
  await expect(headerPlay(page)).toBeVisible()

  await setOffline(context, hf, true)
  await expect(headerPlay(page), 'offline, unsaved: no Play').toHaveCount(0)
  await expect(page.getByText(/Listening needs a connection/)).toHaveCount(1)
  await page.locator('article').click({ position: { x: 100, y: 200 } })
  await page.waitForTimeout(500)
  expect((await audio(page))?.src ?? '', 'clicking the text plays nothing').toBe('')

  await page.goto('/').catch(() => {})
  await page.waitForSelector('text=All Books')
  const pill = page.locator(`a[href="/read/${SLUG}"]`).filter({ hasText: 'Audiobook' })
  await expect(pill, 'offline: no Audiobook pill for the unsaved book').toHaveCount(0)
  await setOffline(context, hf, false)
  await expect(pill.first(), 'back online: the pill returns').toBeAttached()

  // Opened offline (shell from the service worker, no manifest), then reconnected
  await setOffline(context, hf, true)
  await openReader(page)
  await page.waitForTimeout(800)
  await expect(headerPlay(page)).toHaveCount(0)
  await setOffline(context, hf, false)
  await expect(headerPlay(page), 'Play appears without a reload').toHaveCount(1)

  // Saved while 3 chapters were narrated: offline, only those play
  hf.opts.durations = narrated(3)
  await page.reload()
  await page.waitForSelector('article h2')
  await saveAlice(page)
  hf.opts.durations = narrated()
  await page.reload()
  await page.waitForSelector('article h2')
  await setOffline(context, hf, true)
  await expect(headerPlay(page), 'offline, saved: Play shown').toHaveCount(1)
  await page.locator('aside button').nth(4).click()
  await headerPlay(page).click()
  await expect(bar(page), 'unsaved chapter: Play explains').toContainText("isn't saved on this device")
  await expect(headerPlay(page)).toHaveCount(1)
  await page.locator('aside button').nth(1).click()
  await headerPlay(page).click()
  await expect.poll(async () => (await audio(page))?.t ?? 0, { message: 'saved chapter plays' }).toBeGreaterThan(0.5)
  const a = (await audio(page))!
  expect(a.src).toMatch(/^blob:/)
  expect(a.paused).toBe(false)
})

test('connection lost mid-stream: pauses with a message, resumes at the same second', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { durations: narrated(), audioUrl: `${baseURL}/__slow.wav` })
  await openReader(page)
  await headerPlay(page).click()
  await expect.poll(async () => (await audio(page))?.t ?? 0, { timeout: 10_000 }).toBeGreaterThan(2)
  await setOffline(context, hf, true)
  await expect(page.getByRole('status').filter({ hasText: /Connection lost/ })).toHaveCount(1, { timeout: 25_000 })
  expect((await audio(page))!.paused).toBe(true)
  const pos: number = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('bp-prepared-positions') || '{}'))[0] as number)
  expect(pos, 'position kept').toBeGreaterThan(8)
  await expect(bar(page).getByRole('button', { name: 'Resume' }), 'Play again, not a spinner').toHaveCount(1)

  await control(baseURL!, 'slow=0')
  await setOffline(context, hf, false)
  await bar(page).getByRole('button', { name: 'Resume' }).click()
  await expect.poll(async () => { const a = (await audio(page))!; return !a.paused && a.t > pos - 1 }, { timeout: 10_000 }).toBe(true)
  expect((await audio(page))!.t, 'resumes where it stopped').toBeLessThan(pos + 6)
  await expect(page.getByText(/Connection lost/)).toHaveCount(0)
})

test('saving: cancel halfway leaves nothing; a chapter failing twice is retried', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { inline: true, durations: narrated(), delayMs: 300 })
  await swReady(page)
  await openReader(page)
  await page.getByRole('button', { name: /Save offline/ }).click()
  await savingStarted(page)
  await page.getByRole('button', { name: /Cancel/ }).click()
  await expect(page.getByRole('button', { name: /Save offline/ })).toHaveCount(1)
  await page.waitForTimeout(500)
  expect(Object.keys(await savedIndex(page))).toEqual([])
  expect(await cacheKeys(page)).toEqual([])
  await expect(page.getByRole('alert')).toHaveCount(0)

  hf.opts.delayMs = 0
  hf.opts.fail = { 2: 2 }
  hf.requests.length = 0
  await saveAlice(page)
  expect(m4as(hf).filter(p => p.endsWith('/2.m4a'))).toHaveLength(3)
  expect(Object.keys((await savedIndex(page))[SLUG].files).filter(u => u.endsWith('.m4a'))).toHaveLength(N)
})

test('saving: Remove while playing, quota, a failing chapter, two tabs, a page closed mid-save', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { inline: true, durations: narrated() })
  await swReady(page)
  await openReader(page)
  await saveAlice(page)
  await headerPlay(page).click()
  await expect.poll(async () => (await audio(page))?.t ?? 0).toBeGreaterThan(0.5)
  await page.locator('header a[href="/library"]').first().click()
  await page.getByRole('button', { name: 'Remove' }).click()
  await page.waitForFunction(() => !localStorage.getItem('bp-offline-books')?.includes('alice'))
  const t0 = (await audio(page))!.t
  await page.waitForTimeout(1500)
  const a = (await audio(page))!
  expect(a.paused, 'Remove while playing: plays on').toBe(false)
  expect(a.t).toBeGreaterThan(t0 + 1)
  expect(await cacheKeys(page)).toEqual([])
  await bar(page).getByRole('button', { name: 'Pause' }).click()

  // Quota: the fourth file doesn't fit
  await openReader(page)
  await page.evaluate(() => {
    const put = Cache.prototype.put
    let n = 0
    Cache.prototype.put = function (...args) {
      if (++n > 3) return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))
      return put.apply(this, args)
    }
  })
  await page.getByRole('button', { name: /Save offline/ }).click()
  await expect(page.getByRole('alert')).toContainText('Not enough storage space', { timeout: 10_000 })
  expect((await savedIndex(page))[SLUG]).toBeUndefined()
  expect(await cacheKeys(page)).toEqual([])
  await expect(page.getByRole('button', { name: /Retry save/ })).toHaveCount(1)

  // A chapter that keeps failing: 3 attempts, then reported; nothing half-saved
  await page.reload()
  await page.waitForSelector('article h2')
  hf.opts.fail = { 4: Infinity }
  hf.requests.length = 0
  await page.getByRole('button', { name: /Save offline/ }).click()
  await expect(page.getByRole('alert')).toContainText('download failed', { timeout: 15_000 })
  expect(m4as(hf).filter(p => p.endsWith('/4.m4a'))).toHaveLength(3)
  expect((await savedIndex(page))[SLUG]).toBeUndefined()
  expect(await cacheKeys(page)).toEqual([])
  hf.opts.fail = {}

  // Two tabs save the same book at once: every file downloads once, both end up saved
  const page2 = await context.newPage()
  await page.reload()
  await page.waitForSelector('article h2')
  await page2.goto(`/read/${SLUG}`)
  await page2.waitForSelector('article h2')
  hf.opts.delayMs = 100
  hf.requests.length = 0
  await Promise.all([page, page2].map(p => p.getByRole('button', { name: /Save offline/ }).click()))
  await Promise.all([page, page2].map(p => expect(p.getByText('✓ Saved offline')).toBeVisible({ timeout: 30_000 })))
  expect(m4as(hf), 'each chapter downloaded once').toHaveLength(N)
  expect((await cacheKeys(page)).filter(u => u.endsWith('.m4a'))).toHaveLength(N)
  await page2.close()

  // Page closed mid-save: its files are cleared on the next start
  await page.getByRole('link', { name: /Saved offline/ }).click()
  await page.getByRole('button', { name: 'Remove' }).click()
  await page.waitForFunction(() => !localStorage.getItem('bp-offline-books')?.includes('alice'))
  await openReader(page)
  hf.opts.delayMs = 300
  await page.getByRole('button', { name: /Save offline/ }).click()
  await savingStarted(page)
  expect((await cacheKeys(page)).length).toBeGreaterThan(0)
  await page.reload()
  await page.waitForSelector('article h2')
  await expect.poll(() => cacheKeys(page), { message: 'leftover files cleared' }).toEqual([])
  expect((await savedIndex(page))[SLUG]).toBeUndefined()
})

test('Update: new chapters, an older save format, changed text', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { inline: true, durations: narrated(N - 1), noTimings: new Set([3]) })
  let textVersion = 'v1'
  await context.route(`${baseURL}/catalog/${SLUG}.json`, route => {
    const etag = `"${textVersion}"`
    if (route.request().headers()['if-none-match'] === etag) return route.fulfill({ status: 304, headers: { etag } })
    const body = textVersion === 'v1' ? alice : { chapters: alice.chapters.map((c, i) => (i === 0 ? { ...c, content: 'CHANGED TEXT. ' + c.content } : c)) }
    return route.fulfill({ contentType: 'application/json', headers: { etag }, body: route.request().method() === 'HEAD' ? '' : JSON.stringify(body) })
  })
  await swReady(page)
  await openReader(page)
  await saveAlice(page)

  // Chapter 12 narrated since, and chapter 4's timings published
  hf.opts.durations = narrated()
  hf.opts.noTimings = new Set()
  hf.requests.length = 0
  await page.goto('/library')
  const update = page.getByRole('button', { name: /^Update/ })
  await expect(update).toContainText('1 new chapter')
  await update.click()
  await page.waitForFunction(() => !document.body.innerText.includes('Saving'), null, { timeout: 15_000 })
  expect(m4as(hf), 'only the new chapter').toEqual([`af_heart/${SLUG}/${N - 1}.m4a`])
  expect(hf.requests.filter(p => p.endsWith('.timings.json')).sort()).toEqual([`af_heart/${SLUG}/${N - 1}.timings.json`, `af_heart/${SLUG}/3.timings.json`].sort())
  await expect(page.getByRole('button', { name: /^Update/ })).toHaveCount(0)

  // An older save format (no format/version recorded): Update downloads no audio, records them
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('bp-offline-books')!)
    delete all['alice-in-wonderland'].format
    delete all['alice-in-wonderland'].textVersion
    localStorage.setItem('bp-offline-books', JSON.stringify(all))
  })
  await page.reload()
  hf.requests.length = 0
  await page.getByRole('button', { name: /^Update \(read-along\)/ }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('Saving') && !/Update \(/.test(document.body.innerText), null, { timeout: 15_000 })
  const saved = (await savedIndex(page))[SLUG]
  expect(m4as(hf)).toEqual([])
  expect(saved.format).toBe(2)
  expect(saved.textVersion).toBe('"v1"')

  // Text changed on the server: the reader offers Update, which saves the new text
  textVersion = 'v2'
  await openReader(page)
  await page.getByRole('button', { name: 'Update saved book' }).click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 15_000 })
  hf.requests.length = 0
  await setOffline(context, hf, true)
  await page.reload()
  await page.waitForSelector('article h2')
  await page.locator('aside button').first().click()
  await expect(page.locator('article')).toContainText('CHANGED TEXT.')
  expect(m4as(hf)).toEqual([])
})

test.describe('storage notes', () => {
  test.describe('on an iPhone', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' })
    test('My books suggests adding to the Home Screen', async ({ context, baseURL, page }) => {
      await stubHuggingFace(context, baseURL!, { inline: true, durations: narrated() })
      await page.goto('/library')
      await page.waitForSelector('text=Saved on this device')
      await expect(page.getByText(/Add to Home Screen/)).toHaveCount(1)
    })
  })

  test('desktop: no Home Screen note; the storage line matches persist()', async ({ context, baseURL, page }) => {
    await stubHuggingFace(context, baseURL!, { inline: true, durations: narrated() })
    await swReady(page)
    await openReader(page)
    await saveAlice(page)
    await page.goto('/library')
    const section = page.locator('section', { hasText: 'Saved on this device' }).first()
    await expect(section).toBeVisible()
    await page.waitForTimeout(500)
    const persisted = await page.evaluate(() => navigator.storage.persisted())
    await expect(section).not.toContainText('Home Screen')
    await expect(section).toContainText(persisted ? /Kept until you remove them/ : /may remove them/)
  })
})

test('first visit: Google Fonts are cached once the service worker takes over, for offline (books#26)', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  // Stand-ins for Google Fonts, in its format: one subset per comment. Without a family name
  // the page itself never loads them, so only the app's own warm-up can cache them
  const font = (family: string, subset: string) => `https://fonts.gstatic.com/s/${family}/${subset}.woff2`
  await context.route(/^https:\/\/fonts\.googleapis\.com\//, route => {
    const family = /family=(\w+)/.exec(route.request().url())![1].toLowerCase()
    const subsets = { cyrillic: 'U+0400-045F', 'latin-ext': 'U+0100-02BA', latin: 'U+0000-00FF' }
    const body = Object.entries(subsets).map(([s, range]) =>
      `/* ${s} */\n@font-face {\n  src: url(${font(family, s)}) format('woff2');\n  unicode-range: ${range};\n}\n`).join('')
    return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'text/css', body })
  })
  await context.route(/^https:\/\/fonts\.gstatic\.com\//, route =>
    route.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'font/woff2', body: Buffer.from('wOF2') }))

  await swReady(page)
  const cached = (name: string) => page.evaluate(async n => (await (await caches.open(n)).keys()).map(r => r.url).sort(), name)
  await expect.poll(() => cached('fas-font-files-v1'), { message: 'latin font files cached' })
    .toEqual([font('fraunces', 'latin'), font('manrope', 'latin')])
  expect((await cached('fas-font-styles-v1')).length, 'both stylesheets cached').toBe(2)
})

test('a new build: toast while playing, playback carries on, Reload loads it', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!, { durations: narrated() })
  await swReady(page)
  await openReader(page)
  await expect(page.locator('aside[aria-label="App installation and updates"]'), 'SDK update panel hidden').toBeHidden()
  await headerPlay(page).click()
  await expect.poll(async () => (await audio(page))?.t ?? 0, { timeout: 10_000 }).toBeGreaterThan(1)

  await control(baseURL!, 'build=b')
  // The app looks for a new version when it comes back to the foreground
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  const toast = page.getByRole('status').filter({ hasText: 'New version available' })
  await expect(toast).toContainText('Reloading stops playback', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(1)
  // Above the player bar, however tall it is (its chapter list open: books#26)
  await bar(page).getByRole('button', { name: 'Show chapters' }).click()
  await expect.poll(async () => {
    const [t, b] = [await toast.boundingBox(), await bar(page).boundingBox()]
    return t && b ? b.y - (t.y + t.height) : -1
  }, { message: 'toast clear of the player bar' }).toBeGreaterThanOrEqual(8)
  await bar(page).getByRole('button', { name: 'Hide chapters' }).click()
  const t0 = (await audio(page))!.t
  await page.waitForTimeout(3000)
  const a = (await audio(page))!
  expect(a.paused, 'playback carries on').toBe(false)
  expect(a.t).toBeGreaterThan(t0 + 2)
  expect(await page.content()).not.toContain('build-b')

  await page.getByRole('button', { name: 'Reload' }).click()
  await page.waitForFunction(() => document.documentElement.innerHTML.includes('build-b'), null, { timeout: 15_000 })
  await page.waitForSelector('article h2')
  await page.waitForTimeout(1000)
  await expect(page.getByText('New version available')).toHaveCount(0)
})
