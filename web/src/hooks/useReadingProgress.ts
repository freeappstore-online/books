import { useSyncExternalStore } from 'react'
import { loadPosition, type HistoryEntry } from './audioStorage'
import { getNarrationTime } from './narration'
import { preparedUrl, VOICE, type PreparedManifest } from './preparedAudio'

const KEY = 'bp-reading-progress'
const FINISHED_KEY = 'bp-finished'

interface ReadingProgress {
  chapterIdx: number
  totalChapters: number
  /** How far down the chapter the reader is, 0–1 */
  scroll?: number
  /** How far through the book, 0–1, by characters (books#13) */
  fraction?: number
  lastRead: number
}

function loadAll(): Record<string, ReadingProgress> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export function getProgress(slug: string): ReadingProgress | null {
  return loadAll()[slug] || null
}

export function saveProgress(slug: string, chapterIdx: number, totalChapters: number, scroll = 0, fraction?: number) {
  const all = loadAll()
  all[slug] = { chapterIdx, totalChapters, scroll, fraction, lastRead: Date.now() }
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch {}
}

// ── Finished books: slug → when it was marked finished ──
let finished: Record<string, number> = (() => {
  try { return JSON.parse(localStorage.getItem(FINISHED_KEY) || '{}') } catch { return {} }
})()
const finishedListeners = new Set<() => void>()

export function setFinished(slug: string, done: boolean) {
  finished = { ...finished }
  if (done) finished[slug] = Date.now()
  else delete finished[slug]
  try { localStorage.setItem(FINISHED_KEY, JSON.stringify(finished)) } catch {}
  for (const listener of finishedListeners) listener()
}

/** Finished books, slug → when; re-renders when one is marked or unmarked. */
export function useFinished(): Record<string, number> {
  return useSyncExternalStore(
    listener => { finishedListeners.add(listener); return () => { finishedListeners.delete(listener) } },
    () => finished,
  )
}

export interface BookProgress {
  slug: string
  /** Share of the book read, 0–1 */
  read: number
  /** Share of the narration listened to, 0–1; null when never listened */
  listened: number | null
  /** Chapter of the latest of the two */
  chapterIdx: number
  /** When it was last read or listened to */
  at: number
}

/** Share of the book listened to: chapters before the one playing, plus where it stopped. */
function listenedFraction(slug: string, manifest: PreparedManifest): number | null {
  const durations = manifest[VOICE]?.[slug]
  if (!durations) return null
  const idx = loadPosition(slug)
  const total = durations.reduce<number>((sum, d) => sum + (d ?? 0), 0)
  const before = durations.slice(0, idx).reduce<number>((sum, d) => sum + (d ?? 0), 0)
  const now = durations[idx] ? Math.min(getNarrationTime(preparedUrl(slug, idx)), durations[idx]!) : 0
  return total > 0 ? (before + now) / total : null
}

/**
 * Books read or listened to (books#13), latest first: reading positions saved by the
 * reader, listening ones from the player's history. Finished books are left out.
 */
export function booksInProgress(history: HistoryEntry[], manifest: PreparedManifest | null, done: Record<string, number>): BookProgress[] {
  const books = new Map<string, BookProgress>()
  for (const [slug, p] of Object.entries(loadAll())) {
    const read = p.fraction ?? (p.totalChapters > 0 ? (p.chapterIdx + (p.scroll ?? 0)) / p.totalChapters : 0)
    books.set(slug, { slug, read, listened: null, chapterIdx: p.chapterIdx, at: p.lastRead })
  }
  const listenedTo = new Set<string>()
  for (const h of history) {
    const b = books.get(h.slug) ?? { slug: h.slug, read: 0, listened: null, chapterIdx: h.chapterIdx, at: 0 }
    // Known once the manifest has loaded
    if (manifest) b.listened = listenedFraction(h.slug, manifest) ?? 0
    if (h.timestamp > b.at) Object.assign(b, { chapterIdx: h.chapterIdx, at: h.timestamp })
    books.set(h.slug, b)
    listenedTo.add(h.slug)
  }
  return [...books.values()]
    // Opened and left at the very start is not "in progress"
    .filter(b => !done[b.slug] && (b.read > 0 || b.chapterIdx > 0 || listenedTo.has(b.slug)))
    .sort((a, b) => b.at - a.at)
}

/** The progress shown for a book: the further of reading and listening, in whole percent. */
export function progressPercent(p: BookProgress): number {
  return Math.min(100, Math.round(Math.max(p.read, p.listened ?? 0) * 100))
}
