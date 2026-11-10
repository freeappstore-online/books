/**
 * The narration manifest's shape and parsing, free of the edition's data so the build config can
 * use it too (vite.config.ts). The app's side, bound to this edition, is preparedAudio.ts.
 */
import type { CatalogBook } from '../data/book'

/** Root of a Hugging Face dataset's files */
export function datasetBase(dataset: string): string {
  return `https://huggingface.co/datasets/${dataset}/resolve/main`
}

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
export function parseManifestFor(raw: unknown, books: Pick<CatalogBook, 'id' | 'narrationRevision'>[]): { manifest: PreparedManifest; extras: ManifestExtras | null } {
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
  for (const [voice, durations] of Object.entries(manifest)) {
    for (const book of books) {
      if (book.narrationRevision && extras?.[voice]?.[book.id]?.textRevision !== book.narrationRevision) {
        delete durations[book.id]
      }
    }
  }
  return { manifest, extras }
}

/** Number of chapters of a book narrated in `voice`. */
export function narratedCount(m: PreparedManifest, slug: string, voice: string): number {
  return m[voice]?.[slug]?.filter(d => d != null).length ?? 0
}
