/**
 * Read-along: where in the chapter text the audio is (books#20).
 *
 * Prepared AI narration ships sentence timings next to each chapter's audio;
 * the spoken word inside a sentence is estimated by spreading the sentence's
 * time over its words by syllable count.
 */
import { preparedTimingsUrl } from './preparedAudio'

/** Char range [start, end) in the chapter content. */
export type CharRange = [number, number]

export interface ReadAlongPosition {
  chapterIdx: number
  sentence: CharRange | null
  word: CharRange | null
}

/** [charStart, charEnd, startSec, endSec] */
export type TimingSegment = [number, number, number, number]

const timingsCache = new Map<string, Promise<TimingSegment[] | null>>()

/** Sentence timings of a prepared chapter; null when it has none. */
export function loadTimings(slug: string, chapterIdx: number, voice: string): Promise<TimingSegment[] | null> {
  const url = preparedTimingsUrl(slug, chapterIdx, voice)
  let p = timingsCache.get(url)
  if (!p) {
    p = fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(d => (Array.isArray(d?.segments) && d.segments.length > 0 ? d.segments as TimingSegment[] : null))
      .catch(() => null)
    timingsCache.set(url, p)
  }
  return p
}

/** Sentence ranges of `text`, for a sentence highlight without timings. */
export function sentenceRanges(text: string): CharRange[] {
  const ranges: CharRange[] = []
  let start = 0
  const push = (end: number) => {
    while (start < end && /\s/.test(text[start])) start++
    if (start < end) ranges.push([start, end])
    start = end
  }
  for (const m of text.matchAll(/[.!?]+["'”’)\]]*(?=\s)|\n/g)) push(m.index + m[0].length)
  push(text.length)
  return ranges
}

/** Rough syllable count, plus a beat for the pause after a comma or dash. */
function wordWeight(word: string): number {
  const syllables = word.match(/[aeiouy]+/gi)?.length ?? 1
  return Math.max(1, syllables) + (/[,;:—–-]["'”’)\]]*$/.test(word) ? 1 : 0)
}

function words(text: string, [start, end]: CharRange): { range: CharRange; weight: number }[] {
  const out: { range: CharRange; weight: number }[] = []
  for (const m of text.slice(start, end).matchAll(/\S+/g)) {
    out.push({ range: [start + m.index, start + m.index + m[0].length], weight: wordWeight(m[0]) })
  }
  return out
}

/** Last index whose value from `key` is <= `x` (0 when none). */
function lastAtOrBefore<T>(items: T[], x: number, key: (item: T) => number): number {
  let lo = 0, hi = items.length - 1, found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(items[mid]) <= x) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

/** Sentence and estimated word spoken at `t` seconds, from the timings. */
export function positionFromTimings(text: string, segments: TimingSegment[], t: number): { sentence: CharRange; word: CharRange | null } {
  // A seek to a sentence's start can land a sample before it
  const seg = segments[lastAtOrBefore(segments, t + 0.02, s => s[2])]
  const sentence: CharRange = [seg[0], seg[1]]
  const ws = words(text, sentence)
  if (ws.length === 0) return { sentence, word: null }
  const total = ws.reduce((sum, w) => sum + w.weight, 0)
  const span = seg[3] - seg[2]
  const target = span > 0 ? Math.min(1, Math.max(0, (t - seg[2]) / span)) * total : 0
  let acc = 0
  for (const w of ws) {
    acc += w.weight
    if (acc > target) return { sentence, word: w.range }
  }
  return { sentence, word: ws[ws.length - 1].range }
}

/** Sentence at `t` of `duration` seconds, assuming characters are spoken at an even pace. */
export function positionByProportion(text: string, sentences: CharRange[], t: number, duration: number): CharRange | null {
  if (sentences.length === 0 || !(duration > 0)) return null
  const char = Math.min(1, Math.max(0, t / duration)) * text.length
  return sentences[lastAtOrBefore(sentences, char, r => r[0])]
}

/** Seconds at which the word at char `offset` is spoken, from the timings. */
export function timeAtChar(text: string, segments: TimingSegment[], offset: number): number {
  // The sentence holding the offset, or the next one when it falls between sentences
  let i = lastAtOrBefore(segments, offset, s => s[0])
  if (offset >= segments[i][1] && i + 1 < segments.length) i++
  const seg = segments[i]
  const ws = words(text, [seg[0], seg[1]])
  const total = ws.reduce((sum, w) => sum + w.weight, 0)
  let before = 0
  for (const w of ws) {
    if (w.range[1] > offset) break
    before += w.weight
  }
  return seg[2] + (total > 0 ? before / total : 0) * (seg[3] - seg[2])
}
