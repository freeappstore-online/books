import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from '@freeappstore/sdk/pwa-config'
import { CATALOG } from './src/data/catalog'
import { COVERS } from './src/data/covers'
import { MANIFEST_URL, parseManifest, preparedCount } from './src/hooks/preparedAudio'
import { bookPage, openingParagraphs, sitemap } from './src/seo/bookPages'

// Book covers (public/covers/*.webp) stay out of the precache; they are cached as they are shown.
// maxEntries is above the catalogue size so a cover fetched for an offline book is never evicted.
const coverCache = {
  urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/covers/'),
  handler: 'CacheFirst' as const,
  options: { cacheName: 'book-covers-v1', expiration: { maxEntries: 300 } },
}

/** A static page per book, read/<slug>/index.html, and a sitemap listing them (books#47). */
function bookPages(): Plugin {
  return {
    name: 'book-pages',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_, bundle) {
      const shell = bundle['index.html']
      if (shell?.type !== 'asset') throw new Error('book pages: no index.html in the build')
      // Unreachable narration server: the pages just leave out the audiobook line
      const { manifest } = parseManifest(await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(20_000) })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch(e => { this.warn(`narration manifest: ${e}`); return {} }))
      for (const book of CATALOG) {
        const { chapters } = JSON.parse(readFileSync(`public${book.contentPath}`, 'utf8')) as { chapters: { title: string; content: string }[] }
        this.emitFile({
          type: 'asset',
          fileName: `read/${book.id}/index.html`,
          source: bookPage(String(shell.source), book, {
            chapterTitles: chapters.map(c => c.title),
            opening: openingParagraphs(chapters[0].content),
            narrated: preparedCount(manifest, book.id),
            hasCover: COVERS.has(book.id),
          }),
        })
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(CATALOG.map(b => b.id)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), bookPages(), VitePWA(pwaOptions({
    workbox: {
      // The book pages are for search engines; the installed app opens books from the shell
      globIgnores: ['read/**'],
      // silence.wav primes the narration <audio> on iOS and is the pause between chapters; it must load offline too (books#7, #37)
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wav}'],
      runtimeCaching: [...(pwaOptions().workbox.runtimeCaching ?? []), coverCache],
    },
  }))],
  server: { host: true },
})
