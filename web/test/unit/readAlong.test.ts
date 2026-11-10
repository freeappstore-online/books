import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  loadTimings, positionByProportion, positionFromTimings, sentenceRanges, timeAtChar, timeForChar,
  type CharRange, type TimingSegment,
} from '../../src/hooks/readAlong'

// The real Alice chapter 1 and its published timings (serge-ivo/books-audio af_heart/alice-in-wonderland/0.timings.json)
const alice = JSON.parse(readFileSync(new URL('../../public/catalog/alice-in-wonderland.json', import.meta.url), 'utf8')) as { chapters: { content: string }[] }
const text = alice.chapters[0].content
const timings = JSON.parse(readFileSync(new URL('../fixtures/alice-0.timings.json', import.meta.url), 'utf8')) as { v: number; segments: TimingSegment[] }
const segs = timings.segments
const slice = ([a, b]: CharRange) => text.slice(a, b)

/** Every word of the chapter with its char range. */
const words = [...text.matchAll(/\S+/g)].map(m => [m.index, m.index + m[0].length] as CharRange)

describe('sentenceRanges', () => {
  const ranges = sentenceRanges(text)

  it('splits the chapter into ordered, non-overlapping sentences without edge whitespace', () => {
    expect(ranges.length).toBeGreaterThan(50)
    for (let i = 0; i < ranges.length; i++) {
      const [a, b] = ranges[i]
      expect(a).toBeLessThan(b)
      expect(slice(ranges[i])).toBe(slice(ranges[i]).trimStart())
      if (i > 0) expect(a).toBeGreaterThanOrEqual(ranges[i - 1][1])
    }
  })

  it('covers every word of the text', () => {
    const covered = words.every(([a, b]) => ranges.some(([s, e]) => a >= s && b <= e))
    expect(covered).toBe(true)
  })

  it('ends a sentence after closing quotes, like the narration timings do', () => {
    expect(ranges[0]).toEqual([segs[0][0], segs[0][1]])
    expect(slice(ranges[0]).endsWith('conversations?”')).toBe(true)
  })

  it('breaks at newlines and handles text with no punctuation', () => {
    expect(sentenceRanges('One. Two!\nThree')).toEqual([[0, 4], [5, 9], [10, 15]])
    expect(sentenceRanges('no stop here')).toEqual([[0, 12]])
    expect(sentenceRanges('')).toEqual([])
  })
})

describe('positionFromTimings', () => {
  it('starts on the first word of the first sentence', () => {
    const p = positionFromTimings(text, segs, 0)
    expect(p.sentence).toEqual([segs[0][0], segs[0][1]])
    expect(slice(p.word!)).toBe('Alice')
  })

  it('stays in the sentence through the pause after it, on its last word', () => {
    const gap = (segs[0][3] + segs[1][2]) / 2
    const p = positionFromTimings(text, segs, gap)
    expect(p.sentence).toEqual([segs[0][0], segs[0][1]])
    expect(slice(p.word!)).toBe('conversations?”')
  })

  it('treats a time a sample before a sentence as that sentence (seek landing)', () => {
    const p = positionFromTimings(text, segs, segs[1][2] - 0.01)
    expect(p.sentence).toEqual([segs[1][0], segs[1][1]])
  })

  it('moves forward word by word as time goes on', () => {
    const [, , start, end] = segs[5]
    let last = -1
    for (let t = start; t < end; t += 0.25) {
      const { sentence, word } = positionFromTimings(text, segs, t)
      expect(sentence).toEqual([segs[5][0], segs[5][1]])
      expect(word![0]).toBeGreaterThanOrEqual(last)
      last = word![0]
    }
    expect(last).toBeGreaterThan(segs[5][0])
  })

  it('clamps before the start and after the end of the chapter', () => {
    expect(positionFromTimings(text, segs, -5).sentence).toEqual([segs[0][0], segs[0][1]])
    const end = positionFromTimings(text, segs, 10_000)
    const lastSeg = segs[segs.length - 1]
    expect(end.sentence).toEqual([lastSeg[0], lastSeg[1]])
    expect(end.word![1]).toBe(lastSeg[1])
  })

  it('has no word for a segment of whitespace', () => {
    expect(positionFromTimings('a   b', [[1, 3, 0, 1]], 0.5)).toEqual({ sentence: [1, 3], word: null })
  })
})

describe('timeAtChar / timeForChar', () => {
  it('a sentence starts at its timing', () => {
    for (const s of segs) expect(timeAtChar(text, segs, s[0])).toBeCloseTo(s[2], 6)
  })

  it('round-trips: the word at a char is the word read-along shows at its time', () => {
    for (const [a, b] of words.filter((_, i) => i % 7 === 0)) {
      const t = timeAtChar(text, segs, a)
      const { word } = positionFromTimings(text, segs, t + 0.001)
      expect(word, `word ${text.slice(a, b)} at ${a}`).toEqual([a, b])
    }
  })

  it('a click between sentences starts the next one', () => {
    const between = segs[0][1] + 1
    expect(text.slice(segs[0][1], segs[1][0]).trim()).toBe('')
    expect(timeAtChar(text, segs, between)).toBeCloseTo(segs[1][2], 6)
  })

  it('later words never start earlier', () => {
    let last = -1
    for (const [a] of words) {
      const t = timeAtChar(text, segs, a)
      expect(t).toBeGreaterThanOrEqual(last)
      last = t
    }
  })

  it('without timings, places the char by its share of the chapter', () => {
    expect(timeForChar(text, null, 0, 600)).toBe(0)
    expect(timeForChar(text, null, text.length / 2, 600)).toBeCloseTo(300, 6)
    expect(timeForChar('', null, 0, 600)).toBe(0)
    expect(timeForChar(text, segs, segs[3][0], 600)).toBeCloseTo(segs[3][2], 6)
  })
})

describe('positionByProportion', () => {
  const ranges = sentenceRanges(text)

  it('needs sentences and a duration', () => {
    expect(positionByProportion(text, [], 1, 100)).toBeNull()
    expect(positionByProportion(text, ranges, 1, 0)).toBeNull()
    expect(positionByProportion(text, ranges, 1, NaN)).toBeNull()
  })

  it('maps time to the sentence at the same share of the text, clamped', () => {
    expect(positionByProportion(text, ranges, 0, 600)).toEqual(ranges[0])
    expect(positionByProportion(text, ranges, -3, 600)).toEqual(ranges[0])
    expect(positionByProportion(text, ranges, 600, 600)).toEqual(ranges.at(-1))
    expect(positionByProportion(text, ranges, 9999, 600)).toEqual(ranges.at(-1))
    const mid = positionByProportion(text, ranges, 300, 600)!
    expect(mid[0]).toBeLessThanOrEqual(text.length / 2)
    expect(ranges[ranges.indexOf(mid) + 1][0]).toBeGreaterThan(text.length / 2)
  })
})

describe('loadTimings', () => {
  const ok = { ok: true, status: 200, json: async () => ({ v: 1, segments: [[0, 5, 0, 1]] }) }

  it('tries again after a failed request, but remembers timings that are not published (books#28)', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', fetch)
    expect(await loadTimings('retry-book', 0)).toBeNull()
    expect(await loadTimings('retry-book', 0)).toBeNull()
    expect(await loadTimings('retry-book', 0)).toEqual([[0, 5, 0, 1]])
    expect(await loadTimings('retry-book', 0)).toEqual([[0, 5, 0, 1]])
    expect(fetch).toHaveBeenCalledTimes(3)

    fetch.mockResolvedValue({ ok: false, status: 404 })
    expect(await loadTimings('retry-book', 1)).toBeNull()
    expect(await loadTimings('retry-book', 1)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(4)
    vi.unstubAllGlobals()
  })
})
