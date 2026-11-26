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

/** A verified community narration (books#66), as the platform's job set manifest lists it */
interface CommunityArtifact {
  key: string
  url: string
  metaUrl?: string
  durationMs: number | null
}

/** A chapter narrated by a listener's device: its audio and its sentence timings ({segments}) */
export interface CommunityChapter {
  url: string
  metaUrl: string | null
}

/**
 * Add the community's chapters (`raw` is the platform's set manifest, `{artifacts: [...]}`) to
 * `manifest[voice]` where the dataset has none: the dataset wins where both exist. A job key is
 * `<slug>/<chapter>`, or `<slug>/<revision>/<chapter>` for a revised text (its dataset folder);
 * other revisions' narration is dropped. Returns the chapters added, by `<slug>/<chapter>`.
 */
export function mergeCommunity(
  manifest: PreparedManifest, voice: string, raw: unknown,
  books: Pick<CatalogBook, 'id' | 'narrationRevision' | 'chapters'>[],
): Record<string, CommunityChapter> {
  const added: Record<string, CommunityChapter> = {}
  const artifacts = (raw as { artifacts?: unknown } | null)?.artifacts
  if (!Array.isArray(artifacts)) return added
  const byFolder = new Map(books.map(b => [b.narrationRevision ? `${b.id}/${b.narrationRevision}` : b.id, b]))
  for (const a of artifacts as CommunityArtifact[]) {
    const m = typeof a?.key === 'string' ? a.key.match(/^(.+)\/(\d+)$/) : null
    const book = m ? byFolder.get(m[1]) : undefined
    const i = m ? Number(m[2]) : -1
    if (!book || i >= book.chapters || typeof a.url !== 'string' || typeof a.durationMs !== 'number' || a.durationMs <= 0) continue
    const narrated = manifest[voice] ??= {}
    const durations = narrated[book.id] ? [...narrated[book.id]] : Array<number | null>(book.chapters).fill(null)
    if (durations[i] != null) continue
    durations[i] = Math.round(a.durationMs / 100) / 10
    narrated[book.id] = durations
    added[`${book.id}/${i}`] = { url: a.url, metaUrl: typeof a.metaUrl === 'string' ? a.metaUrl : null }
  }
  return added
}
