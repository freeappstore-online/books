import { describe, expect, it } from 'vitest'
import { getNarrationTime, seekNarration } from '../../src/hooks/narration'
import { loadPosition, savePosition, saveHistory, loadHistory, loadRate, loadSleepChoice } from '../../src/hooks/audioStorage'

// Where each chapter was stopped (narration.ts) and which chapter each book is on (audioStorage.ts).
// No <audio> in Node, so these run the "not playing" paths: seeking saves the position for later.
const URL0 = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main/af_heart/alice-in-wonderland/0.m4a'
const URL1 = URL0.replace('/0.m4a', '/1.m4a')

describe('narration position in a chapter', () => {
  it('starts at 0 and resumes where it was moved to', () => {
    expect(getNarrationTime(URL0)).toBe(0)
    seekNarration(URL0, 200, 644.8)
    expect(getNarrationTime(URL0)).toBe(200)
    expect(getNarrationTime(URL1)).toBe(0)
  })

  it('survives a reload (kept in localStorage)', () => {
    seekNarration(URL1, 42, 600)
    expect(JSON.parse(localStorage.getItem('bp-prepared-positions')!)).toEqual({ [URL1]: 42 })
  })

  it('never resumes past the last half second, or before the start', () => {
    seekNarration(URL0, 10_000, 644.8)
    expect(getNarrationTime(URL0)).toBeCloseTo(644.3, 6)
    seekNarration(URL0, -30, 644.8)
    // Under a second is the start: nothing kept
    expect(getNarrationTime(URL0)).toBe(0)
    expect(JSON.parse(localStorage.getItem('bp-prepared-positions')!)).toEqual({})
  })

  it('reads corrupt storage as the start', () => {
    localStorage.setItem('bp-prepared-positions', 'oops')
    expect(getNarrationTime(URL0)).toBe(0)
  })

  it.each(['null', '[]', '42', JSON.stringify({ [URL0]: -10 }), JSON.stringify({ [URL0]: '200' })])('ignores malformed saved seconds: %s', raw => {
    localStorage.setItem('bp-prepared-positions', raw)
    expect(getNarrationTime(URL0)).toBe(0)
    seekNarration(URL0, 20, 600)
    expect(getNarrationTime(URL0)).toBe(20)
  })
})

describe('chapter each book is on', () => {
  it('defaults to the first chapter', () => {
    expect(loadPosition('alice-in-wonderland')).toBe(0)
  })

  it('is saved per book and moves the history entry along', () => {
    saveHistory([{ slug: 'alice-in-wonderland', title: 'Alice', author: 'Carroll', chapterIdx: 0, timestamp: 1 }])
    savePosition('alice-in-wonderland', 4)
    expect(loadPosition('alice-in-wonderland')).toBe(4)
    expect(loadPosition('dracula')).toBe(0)
    expect(loadHistory()[0].chapterIdx).toBe(4)
  })

  it('reads the { chapterIdx, charOffset } format of older versions', () => {
    localStorage.setItem('bp-audio-position', JSON.stringify({ 'alice-in-wonderland': { chapterIdx: 3, charOffset: 120 } }))
    expect(loadPosition('alice-in-wonderland')).toBe(3)
  })

  it.each([-2, 1.5, '3', null])('ignores invalid chapter positions: %s', value => {
    localStorage.setItem('bp-audio-position', JSON.stringify({ alice: value }))
    expect(loadPosition('alice')).toBe(0)
  })

  it.each(['null', '[]', '42'])('can save a new chapter after a malformed position index: %s', value => {
    localStorage.setItem('bp-audio-position', value)
    savePosition('alice', 4)
    expect(loadPosition('alice')).toBe(4)
  })
})

describe('damaged player settings', () => {
  it.each(['null', '{}', '[null, {"slug":"alice"}]'])('ignores malformed history: %s', raw => {
    localStorage.setItem('bp-audio-history', raw)
    expect(loadHistory()).toEqual([])
  })

  it.each(['Infinity', '-1', '9', 'not a number'])('uses safe defaults for invalid playback settings: %s', raw => {
    localStorage.setItem('bp-audio-rate', raw)
    expect(loadRate()).toBe(1)
    if (raw !== '9') {
      localStorage.setItem('bp-audio-sleep', raw)
      expect(loadSleepChoice()).toBeNull()
    }
  })
})
