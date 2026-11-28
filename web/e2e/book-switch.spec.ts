import { test, expect, stubHuggingFace, alice, SLUG, headerPlay, bar, expectPlaying, openChapter } from './fixtures'

test('switching from another book through the player never rewrites annotations or progress with its text', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  const start = alice.chapters[0].content.indexOf('the', 2000)
  const note = { id: 'switch-note', kind: 'highlight', chapterIdx: 0, start, end: start + 3, text: 'the', color: 'yellow', created: 1 }
  await page.goto('/')
  await page.evaluate(([slug, note]) => localStorage.setItem('bp-annotations', JSON.stringify({ [slug]: [note] })), [SLUG, note] as const)
  await context.route('**/catalog/dracula.json', route => route.fulfill({ json: {
    chapters: Array.from({ length: 6 }, (_, i) => ({ title: `Other ${i + 1}`, content: 'the other book.' })),
  } }))
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0)
  await bar(page).getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('link', { name: 'Books', exact: true }).click()
  await page.locator('a[href="/read/dracula/"]').first().click()
  await expect(page.locator('article h2')).toHaveText('Other 1')
  await openChapter(page, 5, { chapters: Array.from({ length: 6 }, (_, i) => ({ title: `Other ${i + 1}`, content: '' })) })
  // Capture every write, including transient corruption that the next render could hide.
  await page.evaluate(() => {
    const w = window as unknown as { __progressWrites: unknown[] }
    w.__progressWrites = []
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bp-reading-progress') w.__progressWrites.push(JSON.parse(value)['alice-in-wonderland'])
      original.call(this, key, value)
    }
  })
  await bar(page).getByRole('button', { name: /Alice/ }).click()
  await expect(page.locator('article h2')).toHaveText(alice.chapters[0].title)
  expect(await page.evaluate(slug => JSON.parse(localStorage.getItem('bp-annotations')!)[slug][0], SLUG)).toMatchObject(note)
  const writes = await page.evaluate(() => (window as unknown as { __progressWrites: { totalChapters: number }[] }).__progressWrites)
  expect(writes.length).toBeGreaterThan(0)
  expect(writes.every(p => p.totalChapters === alice.chapters.length)).toBe(true)
})

test('a late book response cannot replace a newly opened book or corrupt progress on its excerpt fallback', async ({ context, baseURL, page }) => {
  await stubHuggingFace(context, baseURL!)
  await page.goto(`/read/${SLUG}`)
  await headerPlay(page).click()
  await expectPlaying(page, 0)
  await bar(page).getByRole('button', { name: 'Pause', exact: true }).click()
  const progress = await page.evaluate(slug => JSON.parse(localStorage.getItem('bp-reading-progress')!)[slug], SLUG)
  await page.getByRole('link', { name: 'Books', exact: true }).click()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let requested!: () => void
  const requestStarted = new Promise<void>(resolve => { requested = resolve })
  await context.route('**/catalog/dracula.json', async route => {
    requested()
    await held
    await route.fulfill({ json: { chapters: [{ title: 'Late other book', content: 'Other text.' }] } }).catch(() => {})
  })
  await page.locator('a[href="/read/dracula/"]').first().click()
  await requestStarted
  await context.route(`**/catalog/${SLUG}.json`, route => route.fulfill({ status: 503, body: '' }))
  await bar(page).getByRole('button', { name: /Alice/ }).click()
  await expect(page.locator('article h2')).toHaveText('Excerpt')
  release()
  await page.waitForTimeout(300)
  await expect(page.locator('article h2')).toHaveText('Excerpt')
  expect(await page.evaluate(slug => JSON.parse(localStorage.getItem('bp-reading-progress')!)[slug], SLUG)).toEqual(progress)
})
