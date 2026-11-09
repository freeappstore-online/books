/**
 * User's audio library — books queued for background Kokoro generation.
 * Stores the queue in localStorage. Audio goes to IndexedDB via audioCache.
 * Generation runs in the background while the user browses other pages.
 */

import { getCachedAudio, hasCachedAudio, setCachedAudio, cacheKey } from './audioCache'
import { isMobileDevice } from './useKokoro'

const LIBRARY_KEY = 'bp-library'
export const LIBRARY_CHANGED_EVENT = 'bp-library-changed'
export const BG_STATUS_EVENT = 'bp-library-background-status'

export interface LibraryBook {
  slug: string
  title: string
  voiceId: string
  version: string // 'original' | 'child' | 'teenager' | 'tldr' | 'humorous' | etc
  totalChapters: number
  /** How many chapters have been generated and cached */
  generatedChapters: number
  addedAt: number
}

export interface BackgroundGenerationStatus {
  running: boolean
  slug: string | null
  chapter: number
  total: number
  phase: 'idle' | 'checking' | 'generating' | 'done' | 'error'
  message: string
}

let bgStatus: BackgroundGenerationStatus = {
  running: false,
  slug: null,
  chapter: 0,
  total: 0,
  phase: 'idle',
  message: '',
}

export function getLibrary(): LibraryBook[] {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]') } catch { return [] }
}

function saveLibrary(lib: LibraryBook[]) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)) } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT))
  }
}

export function publishBackgroundStatus(next: BackgroundGenerationStatus) {
  bgStatus = next
  console.log(
    '[LibraryBG] status phase=%s running=%s slug=%s chapter=%d/%d message=%s',
    next.phase,
    next.running,
    next.slug ?? '-',
    next.chapter,
    next.total,
    next.message,
  )
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BG_STATUS_EVENT, { detail: next }))
  }
}

export function getBackgroundStatus(): BackgroundGenerationStatus {
  return bgStatus
}

export function addToLibrary(slug: string, title: string, voiceId: string, totalChapters: number, version: string = 'original') {
  const lib = getLibrary()
  if (lib.some(b => b.slug === slug && b.voiceId === voiceId && b.version === version)) return
  lib.push({ slug, title, voiceId, version, totalChapters, generatedChapters: 0, addedAt: Date.now() })
  saveLibrary(lib)
}

export function removeFromLibrary(slug: string) {
  saveLibrary(getLibrary().filter(b => b.slug !== slug))
}

export function isInLibrary(slug: string): boolean {
  return getLibrary().some(b => b.slug === slug)
}

export function updateLibraryProgress(slug: string, voiceId: string, generatedChapters: number, version: string = 'original') {
  const lib = getLibrary()
  const entry = lib.find(b => b.slug === slug && b.voiceId === voiceId && b.version === version)
  if (entry) {
    entry.generatedChapters = generatedChapters
    saveLibrary(lib)
  }
}

/**
 * Check how many chapters of a book are already cached for a given voice.
 */
export async function countCachedChapters(
  slug: string,
  voiceId: string,
  totalChapters: number,
  version: string = 'original',
): Promise<number> {
  let count = 0
  for (let i = 0; i < totalChapters; i++) {
    const cached = await hasCachedAudio(cacheKey(slug, i, voiceId, version))
    if (cached) count++
  }
  return count
}

// ── Background pre-generation queue ──

type GenerateFn = (text: string, voice: string) => Promise<{ audio: Float32Array; sampleRate: number }>
type GetChaptersFn = (slug: string) => Promise<{ content: string }[]>

let bgRunning = false
let bgAbort = false

export function isBackgroundRunning(): boolean { return bgRunning }

export function stopBackground() { bgAbort = true }

/**
 * Run background generation for all library books.
 * Generates one chapter at a time to avoid memory pressure.
 * Skips chapters already cached. Updates library progress.
 * Yields to the main thread between chapters.
 */
export async function runBackgroundGeneration(
  generateFn: GenerateFn,
  getChaptersFn: GetChaptersFn,
  onProgress?: (slug: string, chapter: number, total: number) => void,
) {
  if (bgRunning || isMobileDevice()) return
  bgRunning = true
  bgAbort = false
  publishBackgroundStatus({
    running: true,
    slug: null,
    chapter: 0,
    total: 0,
    phase: 'checking',
    message: 'Preparing background generation...',
  })

  console.log('[Library] Starting background generation...')
  const lib = getLibrary()

  for (const book of lib) {
    if (bgAbort) break
    if (book.generatedChapters >= book.totalChapters) continue

    console.log('[Library] Pre-generating: %s (%d/%d)', book.slug, book.generatedChapters, book.totalChapters)
    publishBackgroundStatus({
      running: true,
      slug: book.slug,
      chapter: Math.min(book.generatedChapters, book.totalChapters),
      total: book.totalChapters,
      phase: 'checking',
      message: `Checking ${book.title} for cached AI chapters...`,
    })

    let chapters: { content: string }[]
    try {
      chapters = await getChaptersFn(book.slug)
    } catch {
      console.log('[Library] Failed to load chapters for %s', book.slug)
      continue
    }

    for (let i = 0; i < chapters.length && !bgAbort; i++) {
      const key = cacheKey(book.slug, i, book.voiceId, book.version)
      const cached = await getCachedAudio(key)
      if (cached) {
        // Already cached locally
        updateLibraryProgress(book.slug, book.voiceId, i + 1, book.version)
        onProgress?.(book.slug, i + 1, chapters.length)
        continue
      }

      try {
        console.log('[Library] Generating %s ch %d/%d...', book.slug, i + 1, chapters.length)
        publishBackgroundStatus({
          running: true,
          slug: book.slug,
          chapter: i + 1,
          total: chapters.length,
          phase: 'generating',
          message: `Generating chapter ${i + 1}/${chapters.length} for ${book.title}...`,
        })

        // Split into sentences and generate each
        const sentences = splitForGeneration(chapters[i].content)
        const audioChunks: Float32Array[] = []
        let sampleRate = 24000

        for (const sentence of sentences) {
          if (bgAbort) break
          const t0 = performance.now()
          const result = await generateFn(sentence, book.voiceId)
          const elapsed = performance.now() - t0
          audioChunks.push(result.audio)
          sampleRate = result.sampleRate
          // Throttle: pause proportionally to generation time so CPU isn't pegged
          await new Promise(r => setTimeout(r, Math.max(50, elapsed * 0.5)))
        }

        if (bgAbort) break

        // Merge chunks and cache
        const totalLen = audioChunks.reduce((s, c) => s + c.length, 0)
        const merged = new Float32Array(totalLen)
        let offset = 0
        for (const chunk of audioChunks) {
          merged.set(chunk, offset)
          offset += chunk.length
        }

        await setCachedAudio(key, merged, sampleRate)
        updateLibraryProgress(book.slug, book.voiceId, i + 1, book.version)
        onProgress?.(book.slug, i + 1, chapters.length)
        console.log('[Library] Cached %s ch %d/%d', book.slug, i + 1, chapters.length)
      } catch (err) {
        console.error('[Library] Failed to generate %s ch %d:', book.slug, i + 1, err)
        publishBackgroundStatus({
          running: true,
          slug: book.slug,
          chapter: i + 1,
          total: chapters.length,
          phase: 'error',
          message: `Failed on chapter ${i + 1}/${chapters.length}. Check the console for details.`,
        })
      }

      // Cooldown between chapters to avoid sustained CPU/GPU pressure
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  bgRunning = false
  bgAbort = false
  publishBackgroundStatus({
    running: false,
    slug: null,
    chapter: 0,
    total: 0,
    phase: 'done',
    message: 'Background generation is idle.',
  })
  console.log('[Library] Background generation complete')
}

function splitForGeneration(text: string): string[] {
  const raw = text.match(/[^.!?。！？]+[.!?。！？]+[\s]*/g) || [text]
  const merged: string[] = []
  let buf = ''
  for (const s of raw) {
    buf += s
    if (buf.length >= 200) { merged.push(buf.trim()); buf = '' }
  }
  if (buf.trim()) merged.push(buf.trim())
  return merged.filter(s => s.length > 0)
}
