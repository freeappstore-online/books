/**
 * Narration pre-generated for the public catalogue (books#4), served from the
 * serge-ivo/books-audio dataset on Hugging Face. Built by
 * .github/workflows/generate-audio.yml.
 */
import { useEffect, useState } from 'react'

const BASE = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main'
export const MANIFEST_URL = `${BASE}/manifest.json`

/** The narrator voice the app plays (manifest key and folder in the dataset). */
export const VOICE = 'af_heart'

/** voice id → book slug → seconds of audio per chapter (null: chapter not narrated) */
export type PreparedManifest = Record<string, Record<string, (number | null)[]>>

let manifestPromise: Promise<PreparedManifest> | null = null
let loadedManifest: PreparedManifest | null = null
/** Whether the loaded manifest came from the network, not the saved copy */
let manifestFresh = false
const manifestListeners = new Set<(m: PreparedManifest) => void>()

export function loadPreparedManifest(): Promise<PreparedManifest> {
  manifestPromise ??= fetch(MANIFEST_URL)
    .then(r => (r.ok ? r.json().then(m => { manifestFresh = true; return m }) : savedManifest()))
    .catch(savedManifest)
    .then(m => {
      loadedManifest = m
      for (const listener of manifestListeners) listener(m)
      return m
    })
  return manifestPromise
}

/** Offline: the copy kept with saved books (offlineBooks.ts), so saved narration still plays. */
async function savedManifest(): Promise<PreparedManifest> {
  const saved = typeof caches === 'undefined' ? undefined : await caches.match(MANIFEST_URL).catch(() => undefined)
  return saved ? saved.json() : {}
}

// Started offline: fetch the full manifest once the connection is back, without a reload (books#24)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (manifestPromise && !manifestFresh) {
      manifestPromise = null
      loadPreparedManifest()
    }
  })
}

/** The manifest if it has loaded, else null. */
export function getLoadedManifest(): PreparedManifest | null {
  return loadedManifest
}

/** The manifest, or null while it is still loading. */
export function usePreparedManifest(): PreparedManifest | null {
  const [manifest, setManifest] = useState(loadedManifest)
  useEffect(() => {
    manifestListeners.add(setManifest)
    loadPreparedManifest().then(setManifest)
    return () => { manifestListeners.delete(setManifest) }
  }, [])
  return manifest
}

/** Whether any chapter of the book has narration. Only these books can be listened to. */
export function isNarrated(m: PreparedManifest, slug: string): boolean {
  return preparedCount(m, slug) > 0
}

/** Seconds of narration of a chapter, null when it has none. */
export function chapterSeconds(m: PreparedManifest, slug: string, chapterIdx: number): number | null {
  return m[VOICE]?.[slug]?.[chapterIdx] ?? null
}

/** Number of chapters of a book narrated in this voice. */
export function preparedCount(m: PreparedManifest, slug: string, voice = VOICE): number {
  return m[voice]?.[slug]?.filter(d => d != null).length ?? 0
}

export function preparedUrl(slug: string, chapterIdx: number, voice = VOICE): string {
  return `${BASE}/${voice}/${slug}/${chapterIdx}.m4a`
}

/** Sentence timings for read-along: {"v":1,"segments":[[charStart,charEnd,startSec,endSec],...]} */
export function preparedTimingsUrl(slug: string, chapterIdx: number, voice = VOICE): string {
  return `${BASE}/${voice}/${slug}/${chapterIdx}.timings.json`
}
