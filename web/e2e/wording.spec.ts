import { test, expect, stubHuggingFace, aiMentions, audio, headerPlay, SLUG } from './fixtures'

test.describe('wording and reading-only books', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await stubHuggingFace(context, baseURL!)
  })

  test('no AI, ✦ or Kokoro anywhere, even with storage from older versions', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('bp-audio-engine', 'kokoro')
      localStorage.setItem('bp-kokoro-voice', 'zf_xiaobei')
      localStorage.setItem('bp-kokoro-ready', 'true')
      localStorage.setItem('bp-audio-voice', 'Google русский')
      localStorage.setItem('bp-language', 'ru')
      localStorage.setItem('bp-library', '[{"slug":"alice-in-wonderland","voiceId":"af_heart"}]')
      localStorage.setItem('bp-audio-position', '{"alice-in-wonderland":{"chapterIdx":0,"charOffset":120}}')
    })
    for (const [path, ready] of [['/', 'text=Audiobooks'], [`/read/${SLUG}`, 'article h2'], ['/library', 'text=Saved on this device'], ['/settings', 'text=Listening']]) {
      await page.goto(path)
      await page.waitForSelector(ready)
      // The manifest decides what shows
      await expect(page.locator('header')).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(await aiMentions(page), path).toEqual([])
    }
  })

  test('the catalogue marks narrated books only', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator(`a[href="/read/${SLUG}"]`).filter({ hasText: 'Audiobook' }).first()).toBeAttached()
    await expect(page.locator('a[href="/read/dracula"]').filter({ hasText: 'Audiobook' })).toHaveCount(0)
  })

  test('the reader has exactly one listen control, Play, and no player before it', async ({ page }) => {
    await page.goto(`/read/${SLUG}`)
    await expect(headerPlay(page)).toBeVisible()
    const controls = await page.evaluate(() =>
      [...document.querySelectorAll('header button, header a')]
        .map(b => `${b.textContent} ${(b as HTMLElement).title || ''} ${b.getAttribute('aria-label') || ''}`.trim())
        .filter(t => !/save/i.test(t) && /play|listen|narrat|voice|generate|library/i.test(t)))
    expect(controls).toEqual(['Play'])
    await expect(page.getByLabel('Position in chapter')).toHaveCount(0)
  })

  test('a book without narration is reading only', async ({ page }) => {
    await page.goto('/read/dracula')
    await page.waitForSelector('article h2')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /play/i })).toHaveCount(0)
    await page.locator('article').click({ position: { x: 100, y: 200 } })
    await page.waitForTimeout(500)
    expect((await audio(page))?.src ?? '').toBe('')
    await expect(page.getByLabel('Position in chapter')).toHaveCount(0)
  })
})
