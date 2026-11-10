/**
 * Narration pre-generated for the public catalogue (books#4), served from the edition's dataset
 * on Hugging Face (audio.dataset in edition/config.json). Built by .github/workflows/generate-audio.yml.
 */
import { useEffect, useState } from 'react'
import { CATALOG } from '../data/catalog'
import { EDITION } from '../data/edition'
import { datasetBase, narratedCount, parseManifestFor, type ManifestExtras, type PreparedManifest } from './manifest'

export type { BookExtras, ManifestExtras, PreparedManifest } from './manifest'

const BASE = datasetBase(EDITION.audio.dataset)
export const MANIFEST_URL = `${BASE}/manifest.json`

/** The narrator voice the app plays (manifest key and folder in the dataset). */
export const VOICE = EDITION.audio.voice

/** The manifest, keeping only narration that matches this edition's texts. */
export function parseManifest(raw: unknown): { manifest: PreparedManifest; extras: ManifestExtras | null } {
  return parseManifestFor(raw, CATALOG)
}

let manifestPromise: Promise<PreparedManifest> | null = null
let loadedManifest: PreparedManifest | null = null
let loadedExtras: ManifestExtras | null = null
/** Whether the loaded manifest came from the network, not the saved copy */
let manifestFresh = false
const manifestListeners = new Set<(m: PreparedManifest) => void>()

export function loadPreparedManifest(): Promise<PreparedManifest> {
  manifestPromise ??= fetch(MANIFEST_URL)
    .then(r => (r.ok ? r.json().then(m => { manifestFresh = true; return m }) : savedManifest()))
    .catch(savedManifest)
    .then(raw => {
      const { manifest: m, extras } = parseManifest(raw)
      loadedManifest = m
      loadedExtras = extras
      for (const listener of manifestListeners) listener(m)
      return m
    })
  return manifestPromise
}

/** Offline: the copy kept with saved books (offlineBooks.ts), so saved narration still plays. */
async function savedManifest(): Promise<unknown> {
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

/** The loaded manifest's extras; null before it loads or when it has none. */
export function getManifestExtras(): ManifestExtras | null {
  return loadedExtras
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
  return narratedCount(m, slug, voice)
}

export function preparedUrl(slug: string, chapterIdx: number, voice = VOICE): string {
  return `${BASE}/${voice}/${narrationPath(slug)}/${chapterIdx}.m4a`
}

function narrationPath(slug: string): string {
  const revision = CATALOG.find(book => book.id === slug)?.narrationRevision
  return revision ? `${slug}/${revision}` : slug
}

/** Whether a chapter may have read-along timings: unknown (true) for a manifest without extras. */
export function hasTimings(extras: ManifestExtras | null, slug: string, voice = VOICE): boolean {
  return !extras || extras[voice]?.[slug]?.timings === true
}

/** Seconds of a chapter's spoken title clip, null when it has none. */
export function titleSeconds(extras: ManifestExtras | null, slug: string, chapterIdx: number, voice = VOICE): number | null {
  const s = extras?.[voice]?.[slug]?.titles?.[chapterIdx]
  return typeof s === 'number' ? s : null
}

/** The chapter's title, spoken: played before it when "Read chapter titles" is on (books#37). */
export function preparedTitleUrl(slug: string, chapterIdx: number, voice = VOICE): string {
  return `${BASE}/${voice}/${narrationPath(slug)}/${chapterIdx}.title.m4a`
}

/** Sentence timings for read-along: {"v":1,"segments":[[charStart,charEnd,startSec,endSec],...]} */
export function preparedTimingsUrl(slug: string, chapterIdx: number, voice = VOICE): string {
  return `${BASE}/${voice}/${narrationPath(slug)}/${chapterIdx}.timings.json`
}
