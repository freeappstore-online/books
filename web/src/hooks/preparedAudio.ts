/**
 * Narration pre-generated for the public catalogue (books#4), served from the
 * serge-ivo/books-audio dataset on Hugging Face. Built by
 * .github/workflows/generate-audio.yml with the same Kokoro model the browser runs.
 */
import { useEffect, useState } from 'react'

const BASE = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main'
export const MANIFEST_URL = `${BASE}/manifest.json`

/** voice id → book slug → seconds of audio per chapter (null: chapter not narrated) */
export type PreparedManifest = Record<string, Record<string, (number | null)[]>>

let manifestPromise: Promise<PreparedManifest> | null = null
let loadedManifest: PreparedManifest | null = null

export function loadPreparedManifest(): Promise<PreparedManifest> {
  manifestPromise ??= fetch(MANIFEST_URL)
    .then(r => (r.ok ? r.json() : savedManifest()))
    .catch(savedManifest)
    .then(m => (loadedManifest = m))
  return manifestPromise
}

/** Offline: the copy kept with saved books (offlineBooks.ts), so saved narration still plays. */
async function savedManifest(): Promise<PreparedManifest> {
  const saved = typeof caches === 'undefined' ? undefined : await caches.match(MANIFEST_URL).catch(() => undefined)
  return saved ? saved.json() : {}
}

/** The manifest if it has loaded, else null. */
export function getLoadedManifest(): PreparedManifest | null {
  return loadedManifest
}

/** The manifest, or null while it is still loading. */
export function usePreparedManifest(): PreparedManifest | null {
  const [manifest, setManifest] = useState(loadedManifest)
  useEffect(() => { loadPreparedManifest().then(setManifest) }, [])
  return manifest
}

/** Whether any chapter of the book has AI narration, in any voice. Only these books can be listened to. */
export function isNarrated(m: PreparedManifest, slug: string): boolean {
  return Object.values(m).some(books => books[slug]?.some(d => d != null))
}

export function isPrepared(m: PreparedManifest, slug: string, chapterIdx: number, voice: string): boolean {
  return m[voice]?.[slug]?.[chapterIdx] != null
}

/** Number of chapters of a book narrated in this voice. */
export function preparedCount(m: PreparedManifest, slug: string, voice: string): number {
  return m[voice]?.[slug]?.filter(d => d != null).length ?? 0
}

export function preparedUrl(slug: string, chapterIdx: number, voice: string): string {
  return `${BASE}/${voice}/${slug}/${chapterIdx}.m4a`
}

/** Sentence timings for read-along: {"v":1,"segments":[[charStart,charEnd,startSec,endSec],...]} */
export function preparedTimingsUrl(slug: string, chapterIdx: number, voice: string): string {
  return `${BASE}/${voice}/${slug}/${chapterIdx}.timings.json`
}
