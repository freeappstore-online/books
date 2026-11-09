/**
 * Narration pre-generated for the public catalogue (books#4), served from the
 * serge-ivo/books-audio dataset on Hugging Face. Built by
 * .github/workflows/generate-audio.yml with the same Kokoro model the browser runs.
 */
import { useEffect, useState } from 'react'

const BASE = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main'

/** voice id → book slug → seconds of audio per chapter (null: chapter not narrated) */
export type PreparedManifest = Record<string, Record<string, (number | null)[]>>

let manifestPromise: Promise<PreparedManifest> | null = null

export function loadPreparedManifest(): Promise<PreparedManifest> {
  manifestPromise ??= fetch(`${BASE}/manifest.json`)
    .then(r => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  return manifestPromise
}

export function usePreparedManifest(): PreparedManifest {
  const [manifest, setManifest] = useState<PreparedManifest>({})
  useEffect(() => { loadPreparedManifest().then(setManifest) }, [])
  return manifest
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
