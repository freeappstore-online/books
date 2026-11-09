/**
 * Books saved for offline reading and listening (books#7).
 *
 * Files live in an app-owned Cache Storage bucket, keyed by the URL they came
 * from: the book's text, every prepared narration chapter (.m4a) and its
 * word timings (.timings.json, when published), plus a copy of the narration
 * manifest so the app knows what's narrated while offline. Which books are
 * saved, and how large each file is, is kept in localStorage.
 */
import { useEffect, useMemo, useState } from 'react'
import { CATALOG } from '../data/catalog'
import { coverUrl } from '../components/BookCover'
import {
  MANIFEST_URL, preparedCount, preparedUrl, preparedTimingsUrl, usePreparedManifest, type PreparedManifest,
} from './preparedAudio'

const CACHE = 'books-offline-v1'
const SAVED_KEY = 'bp-offline-books'
export const OFFLINE_CHANGED_EVENT = 'bp-offline-changed'

/**
 * What a save keeps of a book. Saves made with an older format are offered
 * Update, which downloads only what they lack. 2: the text's version (to
 * notice a changed text) and read-along timings published after a chapter
 * was saved (books#24).
 */
const SAVE_FORMAT = 2
/** Attempts per file before a save reports the failure */
const ATTEMPTS = 3

/**
 * Cross-tab locks (Web Locks): saves hold FILES_LOCK shared and their book's
 * lock exclusively, so a book saves in one tab at a time; clearing the files
 * a closed page left behind holds FILES_LOCK exclusively.
 */
const FILES_LOCK = 'bp-offline-files'
const bookLock = (slug: string) => `bp-offline-${slug}`

/** Measured on Alice chapter 1: 3.2 MB for 615 s of AAC. */
const AUDIO_BYTES_PER_SECOND = 5200

export interface SavedBook {
  /** Voice the narration was saved in; null when the book was saved for reading only */
  voice: string | null
  /** Saved file URL → bytes */
  files: Record<string, number>
  savedAt: number
  /** SAVE_FORMAT of the last complete save or update; absent before format 2 */
  format?: number
  /** ETag of the saved text */
  textVersion?: string
}

export interface SaveJob {
  /** 0..1, by bytes against the estimate */
  progress: number
  cancel: () => void
}

const jobs: Record<string, SaveJob> = {}
const errors: Record<string, string> = {}
/** Books whose text has changed on the server since they were saved */
const textChanged: Record<string, boolean> = {}

function emit() {
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED_EVENT))
}

// Another tab saved or removed a book
window.addEventListener('storage', e => { if (e.key === SAVED_KEY) emit() })

/** Run `fn` holding the named locks in order; without Web Locks (Safari < 15.4) just run it. */
function withLocks<T>(locks: [string, LockOptions][], fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!navigator.locks || locks.length === 0) return fn()
  const [[name, options], ...rest] = locks
  return navigator.locks.request(name, { ...options, signal }, () => withLocks(rest, fn, signal)) as Promise<T>
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

const isQuotaError = (err: unknown) => err instanceof DOMException && err.name === 'QuotaExceededError'

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(id); reject(signal.reason) }, { once: true })
  })
}

/**
 * Download a book's text and every prepared chapter not saved yet. Also used
 * for "Update": only what the saved copy lacks downloads, and the text again
 * when it changed. A failed or cancelled first save leaves nothing behind; a
 * failed update keeps the files it finished. Each file is tried ATTEMPTS times.
 * `voice` null: the text only (updating a book saved for reading).
 */
export function saveBook(slug: string, voice: string | null) {
  const book = CATALOG.find(b => b.id === slug)
  if (!book || jobs[slug]) return
  const controller = new AbortController()
  const job: SaveJob = { progress: 0, cancel: () => controller.abort() }
  jobs[slug] = job
  delete errors[slug]
  emit()
  // Ask the browser not to evict saved books (still inside the click); My books shows the answer
  navigator.storage?.persist?.().then(emit, () => {})

  const signal = controller.signal
  const textUrl = new URL(book.contentPath, location.href).href

  async function run() {
    // Read under the lock: another tab may have saved this book meanwhile
    const previous = getSavedBooks()[slug]
    const files: Record<string, number> = { ...previous?.files }
    let textVersion = previous?.textVersion
    const cache = await caches.open(CACHE)
    let done = 0
    let total = 1

    /** Download `url` into the saved copy; false when an optional file can't be had. */
    async function store(url: string, required: boolean, init?: RequestInit): Promise<Response | false> {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(url, { ...init, signal })
          if (res.status === 304) return res
          if (!res.ok) {
            if (!required && res.status === 404) return false
            throw new Error(`${res.status} for ${url}`)
          }
          const blob = await res.blob()
          await cache.put(url, new Response(blob, { headers: { 'content-type': blob.type } }))
          files[url] = blob.size
          done += blob.size
          job.progress = Math.min(0.99, done / total)
          emit()
          return res
        } catch (err) {
          if (signal.aborted || isQuotaError(err)) throw err
          if (attempt >= ATTEMPTS) {
            if (required) throw err
            return false
          }
          await wait(1000 * attempt, signal)
        }
      }
    }

    try {
      const manifestRes = await fetch(MANIFEST_URL, { signal })
      const manifest: PreparedManifest = manifestRes.ok ? await manifestRes.clone().json() : {}
      const durations = (voice && manifest[voice]?.[slug]) || []
      const narrated = durations.some(d => d != null)
      total = (voice && estimateAudioBytes(manifest, slug, voice)) || 1

      // The text again only when it changed on the server (304 otherwise)
      const text = await store(textUrl, true, files[textUrl] && textVersion
        ? { headers: { 'if-none-match': textVersion } }
        : { cache: 'no-cache' })
      if (text && text.status !== 304) textVersion = text.headers.get('etag') ?? undefined
      // The service worker keeps covers in its own runtime cache (book-covers-v1, never evicted
      // at catalogue size), so fetching it once is enough for it to show offline (books#8)
      const cover = coverUrl(slug)
      if (cover) await fetch(cover, { signal }).catch(() => {})
      if (narrated) await cache.put(MANIFEST_URL, manifestRes)
      for (let i = 0; i < durations.length; i++) {
        if (durations[i] == null) continue
        const audio = preparedUrl(slug, i, voice!)
        if (files[audio]) done += files[audio]
        else await store(audio, true)
        // Word timings sit next to each chapter, and may be published after it
        const timings = preparedTimingsUrl(slug, i, voice!)
        if (!files[timings]) await store(timings, false)
      }
      setSavedBook(slug, { voice: narrated ? voice : null, files, savedAt: Date.now(), format: SAVE_FORMAT, textVersion })
      delete textChanged[slug]
    } catch (err) {
      if (previous) {
        // An interrupted update keeps what it finished downloading
        setSavedBook(slug, { ...previous, files })
      } else {
        await removeFiles(slug, Object.keys(files))
      }
      if (!signal.aborted) {
        errors[slug] = isQuotaError(err)
          ? 'Not enough storage space on this device. Free up some space and try again.'
          : 'The download failed. Check your connection and try again.'
      }
    }
  }

  withLocks([[FILES_LOCK, { mode: 'shared' }], [bookLock(slug), {}]], run, signal)
    .catch(() => {}) // cancelled while another tab was saving it
    .finally(() => {
      delete jobs[slug]
      emit()
    })
}

async function removeFiles(slug: string, urls: string[]) {
  const cache = await caches.open(CACHE)
  await Promise.all(urls.map(url => cache.delete(url)))
  const others = Object.entries(getSavedBooks()).filter(([s, b]) => s !== slug && b.voice)
  if (others.length === 0) await cache.delete(MANIFEST_URL)
}

/**
 * Remove a saved book. A chapter playing from it plays on (its audio is
 * already in memory); later chapters stream, and offline aren't offered.
 */
export function removeSavedBook(slug: string): Promise<void> {
  delete errors[slug]
  delete textChanged[slug]
  return withLocks([[FILES_LOCK, { mode: 'shared' }], [bookLock(slug), {}]], async () => {
    const saved = getSavedBooks()[slug]
    if (!saved) return
    setSavedBook(slug, null)
    await removeFiles(slug, Object.keys(saved.files))
  }).finally(emit)
}

// A book is written to the index only once its save completes. Clear the files of
// saves whose page closed mid-download, while no tab is saving.
if (typeof caches !== 'undefined' && navigator.locks) {
  navigator.locks.request(FILES_LOCK, { ifAvailable: true }, async lock => {
    if (!lock) return
    const books = Object.values(getSavedBooks())
    const keep = new Set(books.flatMap(b => Object.keys(b.files)))
    if (books.some(b => b.voice)) keep.add(MANIFEST_URL)
    const cache = await caches.open(CACHE)
    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req)
  }).catch(() => {})
}

const textChecks = new Set<string>()

/** Find out (once per session) whether a saved book's text has changed on the server. */
export function checkSavedText(slug: string) {
  const saved = getSavedBooks()[slug]
  const book = CATALOG.find(b => b.id === slug)
  if (!saved?.textVersion || !book || textChecks.has(slug) || !navigator.onLine) return
  textChecks.add(slug)
  fetch(book.contentPath, { method: 'HEAD', cache: 'no-cache' })
    .then(res => {
      const etag = res.headers.get('etag')
      if (res.ok && etag && etag !== getSavedBooks()[slug]?.textVersion) {
        textChanged[slug] = true
        emit()
      }
    })
    .catch(() => textChecks.delete(slug))
}

/** What Update would bring to a saved book, or null when it is up to date. */
export function updateReason(slug: string, book: SavedBook, manifest: PreparedManifest): string | null {
  const newChapters = book.voice ? preparedCount(manifest, slug, book.voice) - savedAudioChapters(book) : 0
  if (newChapters > 0) return `${newChapters} new chapter${newChapters === 1 ? '' : 's'}`
  if (textChanged[slug]) return 'updated text'
  if ((book.format ?? 1) < SAVE_FORMAT) return book.voice ? 'read-along' : 'latest text'
  return null
}

/**
 * The narration that can be played now. Offline that is only the chapters
 * saved on this device, though the manifest (loaded earlier, or the saved
 * copy) lists every narrated book (books#24).
 */
export function playableManifest(manifest: PreparedManifest, online = navigator.onLine): PreparedManifest {
  if (online) return manifest
  const saved = getSavedBooks()
  const playable: PreparedManifest = {}
  for (const [voice, books] of Object.entries(manifest)) {
    playable[voice] = {}
    for (const [slug, durations] of Object.entries(books)) {
      const files = saved[slug]?.files
      if (files) playable[voice][slug] = durations.map((d, i) => (preparedUrl(slug, i, voice) in files ? d : null))
    }
  }
  return playable
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

/** usePreparedManifest narrowed to what can be played now; follows the connection and saves. */
export function usePlayableManifest(): PreparedManifest | null {
  const manifest = usePreparedManifest()
  const online = useOnline()
  const { saved } = useOfflineBooks()
  return useMemo(() => manifest && playableManifest(manifest, online), [manifest, online, saved])
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
