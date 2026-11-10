// The books are described in catalog/books/<slug>.toml; books.json is generated from those files and
// the built texts by scripts/catalog/books.py (fetch.py runs it after a build). Don't edit it by hand.
import BOOKS from './books.json'

export interface CatalogBook {
  id: string
  title: string
  author: string
  authorBio: string
  year: number
  genre: string
  tags: string[]
  /** BCP 47 language of the text, e.g. 'en' */
  language: string
  description: string
  excerpt: string
  chapters: number
  readTime: string
  coverGradient: string
  coverAccent: string
  contentPath: string
  /** Revised texts use a separate narration folder and matching manifest revision. */
  narrationRevision?: string
}

export const CATALOG: CatalogBook[] = BOOKS

/** A book's address. Ends in "/" so the host serves its static page, read/<slug>/index.html (books#47). */
export function readPath(slug: string): string {
  return `/read/${slug}/`
}

export function formatYear(year: number): string {
  return year > 0 ? String(year) : `${Math.abs(year)} BC`
}

export const GENRES = [...new Set(CATALOG.map(b => b.genre))].sort()
export const ALL_TAGS = [...new Set(CATALOG.flatMap(b => b.tags))].sort()
