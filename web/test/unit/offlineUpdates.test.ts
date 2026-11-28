import { afterEach, describe, expect, it, vi } from 'vitest'
import { savedAudioChapters, updateReason, type SavedBook } from '../../src/hooks/offlineBooks'
import * as audio from '../../src/hooks/preparedAudio'

const slug = 'alice-in-wonderland'
const voice = 'af_heart'
const manifest = { [voice]: { [slug]: [30] } }
const book = (): SavedBook => ({ voice, files: { [audio.preparedUrl(slug, 0)]: 100 }, savedAt: 1, format: 2 })
afterEach(() => { vi.restoreAllMocks(); audio.addCommunity({}, null) })

describe('offline updates', () => {
  it('offers newly published timings even when audio, text and save format are unchanged', () => {
    const extras = vi.spyOn(audio, 'getManifestExtras').mockReturnValue({ [voice]: { [slug]: { timings: false } } })
    const saved = book()
    expect(updateReason(slug, saved, manifest)).toBeNull()
    extras.mockReturnValue({ [voice]: { [slug]: { timings: true } } })
    expect(updateReason(slug, saved, manifest)).toBe('read-along')
    saved.files[audio.preparedTimingsUrl(slug, 0)] = 50
    expect(updateReason(slug, saved, manifest)).toBeNull()
  })

  it('does not offer speculative timings for a legacy manifest, or audio updates for reading-only saves', () => {
    vi.spyOn(audio, 'getManifestExtras').mockReturnValue(null)
    expect(updateReason(slug, book(), manifest)).toBeNull()
    expect(updateReason(slug, { voice: null, files: {}, savedAt: 1, format: 2 }, manifest)).toBeNull()
  })

  it('counts community audio, excludes its metadata, and offers an update when its URL changes', () => {
    vi.spyOn(audio, 'getManifestExtras').mockReturnValue({})
    const url = 'https://api.freeappstore.online/v1/apps/books/generation/artifacts/chapter?v=1'
    const metaUrl = 'https://api.freeappstore.online/v1/apps/books/generation/artifacts/chapter/meta?v=1'
    audio.addCommunity({}, { artifacts: [{ key: `${slug}/0`, url, metaUrl, durationMs: 30000 }] })
    const saved: SavedBook = { voice, files: { [url]: 100, [metaUrl]: 50 }, savedAt: 1, format: 2 }
    expect(savedAudioChapters(saved)).toBe(1)
    expect(updateReason(slug, saved, manifest)).toBeNull()
    delete saved.files[metaUrl]
    expect(updateReason(slug, saved, manifest)).toBe('read-along')
    audio.addCommunity({}, { artifacts: [{ key: `${slug}/0`, url: url.replace('v=1', 'v=2'), durationMs: 30000 }] })
    expect(updateReason(slug, saved, manifest)).toBe('1 new chapter')
  })
})
