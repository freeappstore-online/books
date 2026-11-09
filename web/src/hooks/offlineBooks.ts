/**
 * Books saved for offline reading and listening (books#7).
 *
 * Files live in an app-owned Cache Storage bucket, keyed by the URL they came
 * from: the book's text, every prepared narration chapter (.m4a) and its
 * word timings (.timings.json, when published), plus a copy of the narration
 * manifest so the app knows what's narrated while offline. Which books are
 * saved, and how large each file is, is kept in localStorage.
 */
import { useEffect, useState } from 'react'
import { CATALOG } from '../data/catalog'
import { coverUrl } from '../components/BookCover'
import { MANIFEST_URL, preparedUrl, type PreparedManifest } from './preparedAudio'

const CACHE = 'books-offline-v1'
const SAVED_KEY = 'bp-offline-books'
export const OFFLINE_CHANGED_EVENT = 'bp-offline-changed'

/** Measured on Alice chapter 1: 3.2 MB for 615 s of AAC. */
const AUDIO_BYTES_PER_SECOND = 5200

export interface SavedBook {
  /** Voice the narration was saved in; null when the book was saved for reading only */
  voice: string | null
  /** Saved file URL → bytes */
  files: Record<string, number>
  savedAt: number
}

export interface SaveJob {
  /** 0..1, by bytes against the estimate */
  progress: number
  cancel: () => void
}

const jobs: Record<string, SaveJob> = {}
const errors: Record<string, string> = {}

function emit() {
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED_EVENT))
}

export function getSavedBooks(): Record<string, SavedBook> {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') } catch { return {} }
}

function setSavedBook(slug: string, book: SavedBook | null) {
  const all = getSavedBooks()
  if (book) all[slug] = book
  else delete all[slug]
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(all)) } catch {}
}

export function savedBytes(book: SavedBook): number {
  return Object.values(book.files).reduce((sum, n) => sum + n, 0)
}

/** Narration chapters saved for this book. */
export function savedAudioChapters(book: SavedBook): number {
  return Object.keys(book.files).filter(url => url.endsWith('.m4a')).length
}

export function timingsUrl(slug: string, chapterIdx: number, voice: string): string {
  return preparedUrl(slug, chapterIdx, voice).replace(/\.m4a$/, '.timings.json')
}

/** The saved copy of a URL, if this device has one. */
export async function savedResponse(url: string): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined
  try {
    return await (await caches.open(CACHE)).match(url)
  } catch {
    return undefined
  }
}

/** Fetch a book file from the saved copy when there is one, else from the network. */
export async function fetchSavedOr(url: string): Promise<Response> {
  return (await savedResponse(url)) ?? fetch(url)
}

/** Estimated download size of a book's narration in this voice. */
export function estimateAudioBytes(manifest: PreparedManifest, slug: string, voice: string): number {
  const seconds = (manifest[voice]?.[slug] ?? []).reduce<number>((sum, d) => sum + (d ?? 0), 0)
  return seconds * AUDIO_BYTES_PER_SECOND
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/**
 * Download a book's text and every prepared chapter not saved yet. Also used
 * for "Update": files already saved are kept, only new chapters download.
 */
export async function saveBook(slug: string, voice: string) {
  const book = CATALOG.find(b => b.id === slug)
  if (!book || jobs[slug]) return
  const controller = new AbortController()
  const job: SaveJob = { progress: 0, cancel: () => controller.abort() }
  jobs[slug] = job
  delete errors[slug]
  emit()
  // Ask the browser not to evict saved books under storage pressure
  navigator.storage?.persist?.().catch(() => {})

  const previous = getSavedBooks()[slug]
  const files: Record<string, number> = { ...previous?.files }
  const cache = await caches.open(CACHE)
  const signal = controller.signal
  let done = 0
  let total = 1
  async function store(url: string, required: boolean): Promise<boolean> {
    const res = await fetch(url, { signal })
    if (!res.ok) {
      if (required) throw new Error(`${res.status} for ${url}`)
      return false
    }
    const blob = await res.blob()
    await cache.put(url, new Response(blob, { headers: { 'content-type': blob.type } }))
    files[url] = blob.size
    done += blob.size
    job.progress = Math.min(0.99, done / total)
    emit()
    return true
  }

  try {
    const manifestRes = await fetch(MANIFEST_URL, { signal })
    const manifest: PreparedManifest = manifestRes.ok ? await manifestRes.clone().json() : {}
    const durations = manifest[voice]?.[slug] ?? []
    const narrated = durations.some(d => d != null)
    total = estimateAudioBytes(manifest, slug, voice) || 1

    await store(new URL(book.contentPath, location.href).href, true)
    // The service worker keeps covers in its own runtime cache (book-covers-v1, never evicted
    // at catalogue size), so fetching it once is enough for it to show offline (books#8)
    const cover = coverUrl(slug)
    if (cover) await fetch(cover, { signal }).catch(() => {})
    if (narrated) await cache.put(MANIFEST_URL, manifestRes)
    for (let i = 0; i < durations.length; i++) {
      if (durations[i] == null) continue
      const audio = preparedUrl(slug, i, voice)
      if (files[audio]) {
        done += files[audio]
        continue
      }
      await store(audio, true)
      // Word timings sit next to each chapter; most chapters may not have them yet
      await store(timingsUrl(slug, i, voice), false)
    }
    setSavedBook(slug, { voice: narrated ? voice : null, files, savedAt: Date.now() })
  } catch (err) {
    if (previous) {
      // An interrupted update keeps what it already downloaded
      setSavedBook(slug, { ...previous, files })
    } else {
      await removeFiles(slug, Object.keys(files))
    }
    if (!signal.aborted) errors[slug] = err instanceof Error ? err.message : 'Download failed'
  } finally {
    delete jobs[slug]
    emit()
  }
}

async function removeFiles(slug: string, urls: string[]) {
  const cache = await caches.open(CACHE)
  await Promise.all(urls.map(url => cache.delete(url)))
  const others = Object.entries(getSavedBooks()).filter(([s, b]) => s !== slug && b.voice)
  if (others.length === 0) await cache.delete(MANIFEST_URL)
}

export async function removeSavedBook(slug: string) {
  const saved = getSavedBooks()[slug]
  if (!saved) return
  setSavedBook(slug, null)
  await removeFiles(slug, Object.keys(saved.files))
  emit()
}

export interface OfflineState {
  saved: Record<string, SavedBook>
  jobs: Record<string, SaveJob>
  errors: Record<string, string>
}

export function useOfflineBooks(): OfflineState {
  const read = () => ({ saved: getSavedBooks(), jobs: { ...jobs }, errors: { ...errors } })
  const [state, setState] = useState(read)
  useEffect(() => {
    const sync = () => setState(read())
    window.addEventListener(OFFLINE_CHANGED_EVENT, sync)
    return () => window.removeEventListener(OFFLINE_CHANGED_EVENT, sync)
  }, [])
  return state
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  return online
}
