import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  VOICE, chapterSeconds, isNarrated, preparedCount, preparedTimingsUrl, preparedUrl, type PreparedManifest,
} from '../../src/hooks/preparedAudio'

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
  })
})
