// What the app knows about a book, and its addresses. Free of the edition's data, so the build
// config can use it (vite.config.ts reads the edition itself, see docs/editions.md).

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

/** A book's address. Ends in "/" so the host serves its static page, read/<slug>/index.html (books#47). */
export function readPath(slug: string): string {
  return `/read/${slug}/`
}

export function formatYear(year: number): string {
  return year > 0 ? String(year) : `${Math.abs(year)} BC`
}
