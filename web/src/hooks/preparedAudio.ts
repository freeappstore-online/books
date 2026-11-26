/**
 * Narration pre-generated for the public catalogue (books#4), served from the edition's dataset
 * on Hugging Face (audio.dataset in edition/config.json). Built by .github/workflows/generate-audio.yml.
 * Chapters the dataset lacks can come from community narration (books#66): listeners' devices
 * narrate the edition's job set on the platform (audio.communitySet), which verifies each one.
 */
import { useEffect, useState } from 'react'
import { CATALOG } from '../data/catalog'
import { EDITION } from '../data/edition'
import {
  datasetBase, mergeCommunity, narratedCount, parseManifestFor, type CommunityChapter, type ManifestExtras, type PreparedManifest,
} from './manifest'

export type { BookExtras, ManifestExtras, PreparedManifest } from './manifest'

const BASE = datasetBase(EDITION.audio.dataset)
export const MANIFEST_URL = `${BASE}/manifest.json`

/** The narrator voice the app plays (manifest key and folder in the dataset). */
export const VOICE = EDITION.audio.voice

/** The platform's list of the verified community narration, when the edition has a job set */
export const COMMUNITY_MANIFEST_URL = EDITION.audio.communitySet
  ? `https://api.freeappstore.online/v1/apps/${EDITION.id}/generation/sets/${EDITION.audio.communitySet}/manifest`
  : null
/** Community chapters in the loaded manifest, by `<slug>/<chapter>` (always in VOICE) */
let community: Record<string, CommunityChapter> = {}

/**
 * Add the community's chapters (the platform manifest's JSON) to `manifest` where the dataset has
 * none, and play them from the platform from now on.
 */
export function addCommunity(manifest: PreparedManifest, raw: unknown) {
  community = { ...community, ...mergeCommunity(manifest, VOICE, raw, CATALOG) }
}

const communityChapter = (slug: string, chapterIdx: number, voice: string) =>
  voice === VOICE ? community[`${slug}/${chapterIdx}`] : undefined

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
  manifestPromise ??= Promise.all([
    fetch(MANIFEST_URL)
      .then(r => (r.ok ? r.json().then(m => { manifestFresh = true; return m }) : savedManifest()))
      .catch(savedManifest),
    COMMUNITY_MANIFEST_URL
      ? fetch(COMMUNITY_MANIFEST_URL).then(r => (r.ok ? r.json() : saved(COMMUNITY_MANIFEST_URL))).catch(() => saved(COMMUNITY_MANIFEST_URL))
      : null,
  ])
    .then(([raw, communityRaw]) => {
      const { manifest: m, extras } = parseManifest(raw)
      addCommunity(m, communityRaw)
      loadedManifest = m
      loadedExtras = extras
      for (const listener of manifestListeners) listener(m)
      return m
    })
  return manifestPromise
}

/** Offline: the copy kept with saved books (offlineBooks.ts), so saved narration still plays. */
function savedManifest(): Promise<unknown> {
  return saved(MANIFEST_URL)
}

async function saved(url: string): Promise<unknown> {
  const res = typeof caches === 'undefined' ? undefined : await caches.match(url).catch(() => undefined)
  return res ? res.json() : {}
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
  const shared = communityChapter(slug, chapterIdx, voice)
  if (shared) return shared.url
  return `${BASE}/${voice}/${narrationPath(slug)}/${chapterIdx}.m4a`
}

function narrationPath(slug: string): string {
  const revision = CATALOG.find(book => book.id === slug)?.narrationRevision
  return revision ? `${slug}/${revision}` : slug
}

/** Whether a book's dataset narration may have read-along timings: unknown (true) for a manifest without extras. */
export function hasTimings(extras: ManifestExtras | null, slug: string, voice = VOICE): boolean {
  return !extras || extras[voice]?.[slug]?.timings === true
}

/** Whether a narrated chapter may have read-along timings, from the dataset or the community. */
export function chapterHasTimings(extras: ManifestExtras | null, slug: string, chapterIdx: number, voice = VOICE): boolean {
  const shared = communityChapter(slug, chapterIdx, voice)
  return shared ? shared.metaUrl !== null : hasTimings(extras, slug, voice)
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
  const shared = communityChapter(slug, chapterIdx, voice)
  if (shared?.metaUrl) return shared.metaUrl
  return `${BASE}/${voice}/${narrationPath(slug)}/${chapterIdx}.timings.json`
}
