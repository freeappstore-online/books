// The books are described in edition/books/<slug>.toml; edition/books.json is generated from those
// files and the built texts by scripts/catalog/books.py (fetch.py runs it after a build). Don't edit it by hand.
import BOOKS from '@edition/books.json'
import type { CatalogBook } from './book'

export const CATALOG: CatalogBook[] = BOOKS

export const GENRES = [...new Set(CATALOG.map(b => b.genre))].sort()
export const ALL_TAGS = [...new Set(CATALOG.flatMap(b => b.tags))].sort()
