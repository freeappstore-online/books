// A static page per book for search engines, and the app still opens there (books#47).
import { test, expect, stubHuggingFace, SLUG } from './fixtures'

test('a book page is served with its own metadata and text, then the app opens the book', async ({ page, request, context, baseURL }) => {
  const html = await (await request.get(`/read/${SLUG}/`)).text()
  expect(html).toContain("<title>Alice's Adventures in Wonderland by Lewis Carroll")
  expect(html).toContain(`<link rel="canonical" href="https://books.freeappstore.online/read/${SLUG}/" />`)
  expect(html).toContain('Alice was beginning to get very tired')

  const sitemap = await (await request.get('/sitemap.xml')).text()
  expect(sitemap).toContain(`<loc>https://books.freeappstore.online/read/${SLUG}/</loc>`)
  expect(sitemap).toContain('<loc>https://books.freeappstore.online/read/dracula/</loc>')

  await stubHuggingFace(context, baseURL!)
  await page.goto(`/read/${SLUG}/`)
  // The reader replaced the static page
  await expect(page.locator('article h2').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The opening' })).toHaveCount(0)
})
