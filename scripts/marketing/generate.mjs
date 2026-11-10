// Generate the FreeWebStore catalogue from the same data as the reader.
// Usage: node scripts/marketing/generate.mjs /tmp/books-marketing
// Patch the existing FreeWebStore section with catalog.json's fragments and
// upload books.js with set_site_script. Keep website styling in FreeWebStore.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = process.argv[2]
if (!out) throw new Error('Pass an output directory: node scripts/marketing/generate.mjs /tmp/books-marketing')
const require = createRequire(resolve(root, 'web/package.json'))
const ts = require('typescript')
async function dataModule(path) {
  const source = readFileSync(resolve(root, path), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { CATALOG } = await dataModule('web/src/data/catalog.ts')
const { COVERS } = await dataModule('web/src/data/covers.ts')
const APP = 'https://books.freeappstore.online'
const SITE = 'https://books.freewebstore.online/'
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const genres = ['Fiction', 'Non-Fiction', 'Drama', 'Poetry']
// Alice is the deliberately selected first audiobook. Do not advertise the
// incomplete narration left in the dataset by the cancelled catalogue run.
const narrated = new Set(['alice-in-wonderland'])
const books = [...CATALOG].sort((a, b) => Number(narrated.has(b.id)) - Number(narrated.has(a.id))
  || a.title.replace(/^(the|a|an) /i, '').localeCompare(b.title.replace(/^(the|a|an) /i, ''), 'en'))
const cards = books.map(b => `<li class="book-card"><h3><a href="${APP}/read/${b.id}">${esc(b.title)}</a></h3><p>${esc(b.author)}</p></li>`).join('')
const counts = [['all', `All (${books.length})`], ['audio', `With audio (${narrated.size})`],
  ...genres.map(g => [g, `${g} (${books.filter(b => b.genre === g).length})`])]
const filters = counts.map(([filter, label]) => `<button class="chip${filter === 'all' ? ' active' : ''}" data-filter="${filter}" type="button" aria-pressed="${filter === 'all'}">${label}</button>`).join('')
const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${SITE}#website`, url: SITE, name: 'Books — Free Classic Books', inLanguage: 'en' },
    { '@type': 'CollectionPage', '@id': `${SITE}#catalog`, url: SITE, name: 'Free Classic Books to Read Online',
      isPartOf: { '@id': `${SITE}#website` }, inLanguage: 'en',
      description: 'Browse classic fiction, philosophy, plays and poetry. Read free, save books offline, and listen to selected narrated titles.',
      mainEntity: { '@type': 'ItemList', numberOfItems: books.length, name: 'Books catalogue', url: `${SITE}#catalog` } },
    { '@type': 'WebApplication', name: 'Books', url: APP, applicationCategory: 'EducationalApplication',
      operatingSystem: 'Any device with a modern web browser', isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
    { '@type': 'Book', name: "Alice's Adventures in Wonderland", author: { '@type': 'Person', name: 'Lewis Carroll' },
      url: `${APP}/read/alice-in-wonderland`, inLanguage: 'en', isAccessibleForFree: true,
      potentialAction: { '@type': 'ReadAction', target: `${APP}/read/alice-in-wonderland` } },
  ],
}
const structured = `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`
const fragments = { bookCount: books.length, cardsHtml: cards, filtersHtml: filters, structuredDataHtml: structured }
const fragmentSize = cards.length + filters.length + structured.length
// Leave room for the website's own heading, controls and CSS within FWS's
// 51200-character section limit. Its design belongs to the website session.
if (fragmentSize > 45000) throw new Error(`Catalogue fragments need another section: ${fragmentSize} characters`)
const rows = CATALOG.map(b => [b.id, b.title, b.author, b.year, genres.indexOf(b.genre), b.chapters, b.readTime,
  Number(COVERS.has(b.id))])
const script = readFileSync(resolve(here, 'books.js.template'), 'utf8').replace('{{BOOKS}}', JSON.stringify(rows))
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'catalog.json'), JSON.stringify(fragments, null, 2))
writeFileSync(resolve(out, 'books.js'), script)
writeFileSync(resolve(out, 'meta.json'), JSON.stringify({
  title: 'Books — Free Classic Books to Read Online & Offline',
  description: `Read ${books.length} classic books free online. Browse fiction, philosophy, plays and poetry. Save books offline and listen to selected narrated titles. No account needed.`,
  noindex: false,
}, null, 2))
console.log(`Generated ${books.length} books; catalogue fragments ${fragmentSize}/45000 characters`)
