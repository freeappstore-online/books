/**
 * Narration pre-generated for the public catalogue (books#4), served from the
 * serge-ivo/books-audio dataset on Hugging Face. Built by
 * .github/workflows/generate-audio.yml.
 */
import { useEffect, useState } from 'react'
import { CATALOG } from '../data/catalog'

const BASE = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main'
export const MANIFEST_URL = `${BASE}/manifest.json`

/** The narrator voice the app plays (manifest key and folder in the dataset). */
export const VOICE = 'af_heart'

/** voice id → book slug → seconds of audio per chapter (null: chapter not narrated) */
export type PreparedManifest = Record<string, Record<string, (number | null)[]>>

/** What else a book has published next to its narration (books#37) */
export interface BookExtras {
  textRevision?: string
  /** Its narrated chapters have read-along timings */
  timings?: boolean
  /** Seconds of each chapter's spoken title clip (null: none) */
  titles?: (number | null)[]
}
/** voice id → book slug → extras; a book missing here has none */
export type ManifestExtras = Record<string, Record<string, BookExtras>>

/**
 * manifest.json is `{voice: {slug: [seconds|null,...]}, extras: ManifestExtras}`.
 * Other top-level keys (added by later pipelines) are ignored. extras is null
 * for a manifest published before it existed: then nothing is known about them.
 */
export function parseManifest(raw: unknown): { manifest: PreparedManifest; extras: ManifestExtras | null } {
  const manifest: PreparedManifest = {}
  let extras: ManifestExtras | null = null
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (isObject(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'extras') {
        if (isObject(value)) extras = value as ManifestExtras
      } else if (isObject(value) && Object.values(value).every(Array.isArray)) {
        manifest[key] = { ...value } as Record<string, (number | null)[]>
      }
    }
  }
  // Restored or re-split texts must never play a previous edition's chapter audio,
  // including a manifest saved for offline use before the text was replaced.
  for (const [voice, books] of Object.entries(manifest)) {
    for (const book of CATALOG) {
      if (book.narrationRevision && extras?.[voice]?.[book.id]?.textRevision !== book.narrationRevision) {
        delete books[book.id]
      }
    }
  }
  return { manifest, extras }
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
  return m[voice]?.[slug]?.filter(d => d != null).length ?? 0
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
