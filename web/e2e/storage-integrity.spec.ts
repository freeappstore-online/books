import { test, expect, stubHuggingFace, SLUG, HF, headerPlay, bar, openReaderMore } from './fixtures'
import type { Page } from '@playwright/test'

const CACHE = 'books-offline-v1'

async function saveOptions(page: Page) {
  await page.locator('article h2').waitFor()
  await openReaderMore(page)
}

test('a reading-only book saves even when the narration host goes down', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { inline: true })
  await page.goto('/read/pride-and-prejudice')
  await saveOptions(page)
  const save = page.getByRole('button', { name: 'Save to read offline' })
  await expect(save).toBeVisible()
  hf.offline = true
  await save.click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 15_000 })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bp-offline-books')!))
  expect(saved['pride-and-prejudice'].voice).toBeNull()
})

test('an update repairs cached files missing from a previously saved book', async ({ context, baseURL, page }) => {
  const hf = await stubHuggingFace(context, baseURL!, { inline: true })
  await page.goto(`/read/${SLUG}`)
  await saveOptions(page)
  await page.getByRole('button', { name: /Save offline/ }).click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(async ({ cacheName, slug, hfRoot }) => {
    const cache = await caches.open(cacheName)
    await cache.delete(`${hfRoot}af_heart/${slug}/0.m4a`)
    await cache.delete(`${hfRoot}af_heart/${slug}/0.timings.json`)
  }, { cacheName: CACHE, slug: SLUG, hfRoot: HF })
  await page.reload()
  await saveOptions(page)
  // WebKit's temporary browser context can evict the entire cache on reload.
  // Repair exactly what is missing now, whether one chapter or the whole copy.
  const missingAudio = await page.evaluate(async ({ cacheName, slug }) => {
    const cache = await caches.open(cacheName)
    const present = new Set((await cache.keys()).map(r => r.url))
    const saved = JSON.parse(localStorage.getItem('bp-offline-books')!)[slug]
    return Object.keys(saved.files).filter(url => url.endsWith('.m4a') && !present.has(url))
  }, { cacheName: CACHE, slug: SLUG })
  hf.requests.length = 0
  await page.getByRole('button', { name: 'Update saved book' }).click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 15_000 })
  expect(hf.requests.filter(p => p.endsWith('.m4a'))).toEqual(missingAudio.map(url => url.slice(HF.length)))
  expect(await page.evaluate(async ({ cacheName, url }) => !!await (await caches.open(cacheName)).match(url),
    { cacheName: CACHE, url: `${HF}af_heart/${SLUG}/0.m4a` })).toBe(true)
})

test('a full localStorage index reports failure and rolls back the download', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!, { inline: true })
  await page.goto('/read/pride-and-prejudice')
  await saveOptions(page)
  await expect(page.getByRole('button', { name: 'Save to read offline' })).toBeVisible()
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bp-offline-books') throw new DOMException('Full', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Save to read offline' }).click()
  await expect(page.getByRole('alert')).toContainText('Not enough storage space')
  expect(await page.evaluate(async name => (await (await caches.open(name)).keys()).length, CACHE)).toBe(0)
  await expect(page.getByText('✓ Saved offline')).toHaveCount(0)
})

test('unavailable Cache Storage reports a save error instead of silently stopping', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  await page.goto('/read/pride-and-prejudice')
  await saveOptions(page)
  await expect(page.getByRole('button', { name: 'Save to read offline' })).toBeVisible()
  await page.evaluate(() => {
    CacheStorage.prototype.open = () => Promise.reject(new DOMException('Unavailable', 'SecurityError'))
  })
  await page.getByRole('button', { name: 'Save to read offline' }).click()
  await expect(page.getByRole('alert')).toContainText("Couldn't save this book")
})

test('pausing during a slow saved-file lookup never starts the cancelled chapter', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  await page.goto(`/read/${SLUG}`)
  await expect(headerPlay(page)).toBeVisible()
  await page.evaluate(() => {
    const state = window as unknown as { releaseCache: () => void; chapterStarts: number }
    state.chapterStarts = 0
    const match = Cache.prototype.match
    Cache.prototype.match = async function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url
      if (url.endsWith('.m4a')) await new Promise<void>(resolve => { state.releaseCache = resolve })
      return match.apply(this, args)
    }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (this.src.endsWith('.m4a')) state.chapterStarts++
      return play.call(this)
    }
  })
  await headerPlay(page).click()
  await page.waitForFunction(() => typeof (window as unknown as { releaseCache?: unknown }).releaseCache === 'function')
  await bar(page).getByRole('button', { name: 'Pause' }).click()
  await page.evaluate(() => (window as unknown as { releaseCache: () => void }).releaseCache())
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { chapterStarts: number }).chapterStarts)).toBe(0)
  await expect(bar(page).getByRole('button', { name: 'Resume' })).toBeVisible()
})

test('unsaved bookmarks survive more edits in this tab and can be retried', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  await page.goto(`/read/${SLUG}`)
  await page.getByRole('button', { name: 'Bookmarks and notes', exact: true }).click()
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    ;(window as unknown as { restoreStorage: () => void }).restoreStorage = () => { Storage.prototype.setItem = set }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bp-annotations') throw new DOMException('Full', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Bookmark this place' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  await page.getByRole('button', { name: 'Bookmark this place' }).click()
  expect(await page.evaluate(() => localStorage.getItem('bp-annotations'))).toBeNull()
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage())
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(slug => JSON.parse(localStorage.getItem('bp-annotations')!)[slug].length, SLUG)).toBe(2)
  await page.reload()
  await page.getByRole('button', { name: 'Bookmarks and notes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toHaveCount(2)
})

test('an update whose index cannot be saved preserves the previous offline audiobook', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!, { inline: true, durations: [20] })
  await page.goto(`/read/${SLUG}`)
  await saveOptions(page)
  await page.getByRole('button', { name: /Save offline/ }).click()
  await expect(page.getByText('✓ Saved offline')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(slug => {
    const saved = JSON.parse(localStorage.getItem('bp-offline-books')!)
    saved[slug].format = 1
    localStorage.setItem('bp-offline-books', JSON.stringify(saved))
    window.dispatchEvent(new CustomEvent('bp-offline-changed'))
  }, SLUG)
  await expect(page.getByRole('button', { name: 'Update saved book' })).toBeVisible()
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bp-offline-books') throw new DOMException('Full', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Update saved book' }).click()
  await expect(page.getByRole('alert')).toContainText('Not enough storage space')
  await expect(page.getByRole('status').filter({ hasText: 'Saving failed' })).toHaveCount(1)
  const keys = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => r.url), CACHE)
  expect(keys).toContain(`${HF}manifest.json`)
  expect(keys).toContain(`${HF}af_heart/${SLUG}/0.m4a`)
  expect(await page.evaluate(slug => JSON.parse(localStorage.getItem('bp-offline-books')!)[slug].format, SLUG)).toBe(1)
})
