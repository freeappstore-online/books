import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CATALOG } from '../../src/data/catalog'
import {
  VOICE, addCommunity, chapterHasTimings, chapterSeconds, hasTimings, isNarrated, parseManifest, preparedCount,
  preparedTimingsUrl, preparedTitleUrl, preparedUrl, titleSeconds, type PreparedManifest,
} from '../../src/hooks/preparedAudio'
import { mergeCommunity } from '../../src/hooks/manifest'

// The real manifest.json of serge-ivo/books-audio (Alice only)
const real = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8')) as PreparedManifest
const SLUG = 'alice-in-wonderland'
/** A book narrated in parts: chapter 2 and the last one missing */
const partial: PreparedManifest = { [VOICE]: { [SLUG]: [10, null, 12, null] }, other_voice: { dracula: [5] } }

describe('preparedAudio', () => {
  it('reads chapter seconds from the real manifest', () => {
    expect(chapterSeconds(real, SLUG, 0)).toBe(644.8)
    expect(chapterSeconds(real, SLUG, 11)).toBe(664.6)
    expect(chapterSeconds(real, SLUG, 12)).toBeNull()
    expect(chapterSeconds(real, 'dracula', 0)).toBeNull()
  })

  it('a null chapter has no narration', () => {
    expect(chapterSeconds(partial, SLUG, 1)).toBeNull()
    expect(chapterSeconds(partial, SLUG, 2)).toBe(12)
  })

  it('counts narrated chapters per voice', () => {
    expect(preparedCount(real, SLUG)).toBe(12)
    expect(preparedCount(partial, SLUG)).toBe(2)
    expect(preparedCount(partial, 'dracula')).toBe(0)
    expect(preparedCount(partial, 'dracula', 'other_voice')).toBe(1)
    expect(preparedCount({}, SLUG)).toBe(0)
  })

  it('only books with a narrated chapter in the app voice are narrated', () => {
    expect(isNarrated(real, SLUG)).toBe(true)
    expect(isNarrated(real, 'dracula')).toBe(false)
    expect(isNarrated(partial, 'dracula')).toBe(false)
    expect(isNarrated({ [VOICE]: { [SLUG]: [null, null] } }, SLUG)).toBe(false)
    expect(isNarrated({}, SLUG)).toBe(false)
  })

  it('builds the dataset URLs', () => {
    const base = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main/af_heart/alice-in-wonderland'
    expect(preparedUrl(SLUG, 3)).toBe(`${base}/3.m4a`)
    expect(preparedTimingsUrl(SLUG, 3)).toBe(`${base}/3.timings.json`)
    expect(preparedTitleUrl(SLUG, 3)).toBe(`${base}/3.title.m4a`)
  })
})

describe('manifest contract (books#37)', () => {
  it('rejects old narration after restoring a text, including an offline manifest', () => {
    const book = CATALOG.find(b => b.id === 'as-i-lay-dying')!
    // This book's complete text must not reuse the ten excerpt recordings.
    expect(book.narrationRevision).toBeTruthy()
    const raw = { [VOICE]: { [book.id]: [300], [SLUG]: [10] } }
    expect(parseManifest(raw).manifest[VOICE][book.id]).toBeUndefined()
    expect(parseManifest(raw).manifest[VOICE][SLUG]).toEqual([10])
    expect(raw[VOICE][book.id]).toEqual([300])
    const revised = { ...raw, extras: { [VOICE]: { [book.id]: { textRevision: book.narrationRevision } } } }
    expect(parseManifest(revised).manifest[VOICE][book.id]).toEqual([300])
    expect(preparedUrl(book.id, 0)).toContain(`/${book.id}/${book.narrationRevision}/0.m4a`)
    expect(preparedTitleUrl(book.id, 0)).toContain(`/${book.id}/${book.narrationRevision}/0.title.m4a`)
    expect(preparedTimingsUrl(book.id, 0)).toContain(`/${book.id}/${book.narrationRevision}/0.timings.json`)
  })

  const raw = {
    [VOICE]: { [SLUG]: [10, null, 12], emma: [5] },
    extras: { [VOICE]: { [SLUG]: { timings: true, titles: [2.1, null, 1.8] }, emma: { titles: [1] } } },
    // Keys a later pipeline may add
    generated: '2026-11-10',
    stats: { books: 2 },
  }

  it('keeps the voices, separates the extras and ignores other top-level keys', () => {
    const { manifest, extras } = parseManifest(raw)
    expect(manifest).toEqual({ [VOICE]: raw[VOICE] })
    expect(extras).toEqual(raw.extras)
    expect(isNarrated(manifest, SLUG)).toBe(true)
  })

  it('a manifest without extras, or not an object, has none', () => {
    expect(parseManifest({ [VOICE]: { [SLUG]: [1] } })).toEqual({ manifest: { [VOICE]: { [SLUG]: [1] } }, extras: null })
    expect(parseManifest(null)).toEqual({ manifest: {}, extras: null })
    expect(parseManifest([1])).toEqual({ manifest: {}, extras: null })
  })

  it('says which books have timings: unknown (yes) without extras', () => {
    const { extras } = parseManifest(raw)
    expect(hasTimings(extras, SLUG)).toBe(true)
    expect(hasTimings(extras, 'emma')).toBe(false)
    expect(hasTimings(extras, 'dracula')).toBe(false)
    expect(hasTimings(null, 'emma')).toBe(true)
  })

  it('reads the title clip lengths', () => {
    const { extras } = parseManifest(raw)
    expect(titleSeconds(extras, SLUG, 0)).toBe(2.1)
    expect(titleSeconds(extras, SLUG, 1)).toBeNull()
    expect(titleSeconds(extras, SLUG, 7)).toBeNull()
    expect(titleSeconds(extras, 'dracula', 0)).toBeNull()
    expect(titleSeconds(null, SLUG, 0)).toBeNull()
  })
})

describe('community narration (books#66)', () => {
  beforeEach(() => addCommunity({}, null))
  const api = 'https://api.freeappstore.online/v1/apps/books/generation/artifacts'
  const artifact = (key: string, durationMs: number | null, meta = true) => ({
    key, jobId: key, url: `${api}/${key}?v=1`, ...(meta ? { metaUrl: `${api}/${key}/meta?v=1` } : {}), durationMs,
  })
  const books = [{ id: SLUG, chapters: 4 }, { id: 'as-i-lay-dying', chapters: 3, narrationRevision: 'complete-text-v1' }]

  it('fills only the chapters the dataset lacks: the dataset wins', () => {
    const manifest: PreparedManifest = { [VOICE]: { [SLUG]: [10, null, 12, null] } }
    const raw = { artifacts: [artifact(`${SLUG}/0`, 99_000), artifact(`${SLUG}/1`, 20_049), artifact(`${SLUG}/3`, 5_000, false)] }
    const added = mergeCommunity(manifest, VOICE, raw, books)
    expect(manifest[VOICE][SLUG]).toEqual([10, 20, 12, 5])
    expect(Object.keys(added)).toEqual([`${SLUG}/1`, `${SLUG}/3`])
    expect(added[`${SLUG}/3`].metaUrl).toBeNull()
  })

  it('adds books the dataset has none of, and drops other revisions, unverified and unknown chapters', () => {
    const manifest: PreparedManifest = {}
    const raw = { artifacts: [
      artifact('as-i-lay-dying/0', 1_000), artifact('as-i-lay-dying/complete-text-v1/2', 3_000),
      artifact(`${SLUG}/1`, null), artifact(`${SLUG}/9`, 1_000), artifact('no-such-book/0', 1_000), { key: 7 },
    ] }
    expect(Object.keys(mergeCommunity(manifest, VOICE, raw, books))).toEqual(['as-i-lay-dying/2'])
    expect(manifest).toEqual({ [VOICE]: { 'as-i-lay-dying': [null, null, 3] } })
    expect(mergeCommunity(manifest, VOICE, null, books)).toEqual({})
    expect(mergeCommunity(manifest, VOICE, { artifacts: 'x' }, books)).toEqual({})
  })

  it('plays and times community chapters from the platform', () => {
    const { manifest, extras } = parseManifest({ [VOICE]: { [SLUG]: [10, null] }, extras: { [VOICE]: { [SLUG]: { timings: false } } } })
    addCommunity(manifest, { artifacts: [artifact(`${SLUG}/1`, 30_000), artifact(`${SLUG}/0`, 1_000)] })
    expect(chapterSeconds(manifest, SLUG, 1)).toBe(30)
    expect(preparedUrl(SLUG, 1)).toBe(`${api}/${SLUG}/1?v=1`)
    expect(preparedTimingsUrl(SLUG, 1)).toBe(`${api}/${SLUG}/1/meta?v=1`)
    expect(chapterHasTimings(extras, SLUG, 1)).toBe(true)
    // The dataset's chapter stays the dataset's
    expect(preparedUrl(SLUG, 0)).toContain('huggingface.co')
    expect(chapterHasTimings(extras, SLUG, 0)).toBe(false)
    expect(preparedUrl(SLUG, 1, 'other_voice')).toContain('huggingface.co')
  })

  it('replaces community routing when the dataset takes over a chapter', () => {
    const raw = { artifacts: [artifact(`${SLUG}/1`, 30_000)] }
    addCommunity({}, raw)
    expect(preparedUrl(SLUG, 1)).toContain(api)
    addCommunity({ [VOICE]: { [SLUG]: [10, 31] } }, raw)
    expect(preparedUrl(SLUG, 1)).toContain('huggingface.co')
    expect(preparedTimingsUrl(SLUG, 1)).toContain('huggingface.co')
    expect(chapterHasTimings({ [VOICE]: { [SLUG]: { timings: false } } }, SLUG, 1)).toBe(false)
  })

  it('drops withdrawn community artifacts on the next manifest snapshot', () => {
    addCommunity({}, { artifacts: [artifact(`${SLUG}/1`, 30_000)] })
    expect(preparedUrl(SLUG, 1)).toContain(api)
    const refreshed: PreparedManifest = {}
    addCommunity(refreshed, { artifacts: [] })
    expect(chapterSeconds(refreshed, SLUG, 1)).toBeNull()
    expect(preparedUrl(SLUG, 1)).toContain('huggingface.co')
  })
})
