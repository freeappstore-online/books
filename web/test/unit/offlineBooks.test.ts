import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  estimateAudioBytes, formatBytes, getSavedBooks, savedAudioChapters, savedBytes, type SavedBook,
} from '../../src/hooks/offlineBooks'
import type { PreparedManifest } from '../../src/hooks/preparedAudio'

const real = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8')) as PreparedManifest
const SLUG = 'alice-in-wonderland'
const BASE = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main/af_heart/alice-in-wonderland'

describe('offline size estimate', () => {
  it('is the narrated seconds at the measured AAC bitrate', () => {
    const seconds = real.af_heart[SLUG].reduce<number>((s, d) => s + (d ?? 0), 0)
    expect(estimateAudioBytes(real, SLUG, 'af_heart', null)).toBeCloseTo(seconds * 5200, 3)
    // Alice is about 8150 s: roughly 41 MB, what the Save offline button shows
    expect(formatBytes(estimateAudioBytes(real, SLUG, 'af_heart', null))).toBe('41 MB')
  })

  it('skips chapters without narration and unknown books or voices', () => {
    expect(estimateAudioBytes({ af_heart: { [SLUG]: [10, null, 5] } }, SLUG, 'af_heart', null)).toBe(15 * 5200)
    expect(estimateAudioBytes(real, 'dracula', 'af_heart', null)).toBe(0)
    expect(estimateAudioBytes(real, SLUG, 'bf_emma', null)).toBe(0)
  })

  it('counts the spoken chapter titles of narrated chapters (books#37)', () => {
    const extras = { af_heart: { [SLUG]: { titles: [2, 3, 4] } } }
    // Chapter 2 has a title clip but no narration: not saved, not counted
    expect(estimateAudioBytes({ af_heart: { [SLUG]: [10, null, 5] } }, SLUG, 'af_heart', extras)).toBe((10 + 2 + 5 + 4) * 5200)
  })
})

describe('formatBytes', () => {
  it('shows KB below a megabyte, never 0 KB', () => {
    expect(formatBytes(0)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('2 KB')
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB')
  })

  it('shows one decimal below 10 MB, whole MB above', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(3.24 * 1024 * 1024)).toBe('3.2 MB')
    expect(formatBytes(12.6 * 1024 * 1024)).toBe('13 MB')
  })
})

describe('saved books', () => {
  const book: SavedBook = {
    voice: 'af_heart',
    files: {
      'https://books.freeappstore.online/catalog/alice-in-wonderland.json': 120_000,
      [`${BASE}/0.m4a`]: 3_300_000,
      [`${BASE}/0.timings.json`]: 2_000,
      [`${BASE}/1.m4a`]: 3_100_000,
      [`${BASE}/1.title.m4a`]: 10_000,
    },
    savedAt: 1,
  }

  it('sum their file sizes and count saved narration chapters', () => {
    expect(savedBytes(book)).toBe(6_532_000)
    // A spoken title isn't a chapter
    expect(savedAudioChapters(book)).toBe(2)
    expect(savedAudioChapters({ voice: null, files: {}, savedAt: 1 })).toBe(0)
  })

  it('are read from storage, and corrupt storage reads as none', () => {
    expect(getSavedBooks()).toEqual({})
    localStorage.setItem('bp-offline-books', JSON.stringify({ [SLUG]: book }))
    expect(getSavedBooks()[SLUG]).toEqual(book)
    localStorage.setItem('bp-offline-books', '{not json')
    expect(getSavedBooks()).toEqual({})
  })

  it.each(['null', '[]', '12', '{"alice":null}', '{"alice":{"files":null}}'])('ignores malformed saved-book indexes: %s', raw => {
    localStorage.setItem('bp-offline-books', raw)
    expect(getSavedBooks()).toEqual({})
  })
})
