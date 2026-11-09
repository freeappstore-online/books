/**
 * Search inside a book (books#12), in the browser on the loaded chapters.
 * Case-, accent- and curly-quote-insensitive.
 */

export interface SearchHit {
  chapterIdx: number
  /** Char range [start, end) in the chapter content */
  start: number
  end: number
}

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' }
const folds = new Map<string, string>()

/** One char folded to one char, so offsets in the folded text are offsets in the original. */
function foldChar(ch: string): string {
  let f = folds.get(ch)
  if (f === undefined) {
    const n = QUOTES[ch] ?? ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    f = n.length === 1 ? n : ch
    folds.set(ch, f)
  }
  return f
}

export function foldText(text: string): string {
  const lower = text.toLowerCase()
  // A few chars lower-case to two (İ): then fold char by char to keep offsets
  if (lower.length !== text.length) return text.replace(/[^]/g, foldChar)
  return lower.replace(/[^\x00-\x7f]/g, foldChar)
}

/** Folded chapters of a book, built once per chapters array (Ulysses: about 20 ms). */
const indexes = new WeakMap<object, string[]>()
function foldedChapters(chapters: { content: string }[]): string[] {
  let folded = indexes.get(chapters)
  if (!folded) {
    folded = chapters.map(c => foldText(c.content))
    indexes.set(chapters, folded)
  }
  return folded
}

/** Every match of `query` across the book, in reading order. */
export function searchBook(chapters: { content: string }[], query: string): SearchHit[] {
  const q = foldText(query.trim().replace(/\s+/g, ' '))
  if (q.length < 2) return []
  const hits: SearchHit[] = []
  foldedChapters(chapters).forEach((text, chapterIdx) => {
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
      hits.push({ chapterIdx, start: i, end: i + q.length })
    }
  })
  return hits
}

/** The text around a hit, cut at word boundaries. */
export function snippet(content: string, hit: SearchHit, around = 50): { before: string; match: string; after: string } {
  let a = Math.max(0, hit.start - around)
  let b = Math.min(content.length, hit.end + around)
  if (a > 0) a = content.indexOf(' ', a) + 1 || a
  if (b < content.length) b = content.lastIndexOf(' ', b) > hit.end ? content.lastIndexOf(' ', b) : b
  const clean = (s: string) => s.replace(/\s+/g, ' ')
  return {
    before: (a > 0 ? '…' : '') + clean(content.slice(a, hit.start)),
    match: clean(content.slice(hit.start, hit.end)),
    after: clean(content.slice(hit.end, b)) + (b < content.length ? '…' : ''),
  }
}
