import { readLocal, readLocalRecord, writeLocal } from './localStorage'
/**
 * Audio player persistence — all localStorage operations in one place.
 * Each function has its own try/catch so callers never crash on storage errors.
 */

// ── Keys ──
const HISTORY_KEY = 'bp-audio-history'
const POSITION_KEY = 'bp-audio-position'
const RATE_KEY = 'bp-audio-rate'
const SLEEP_KEY = 'bp-audio-sleep'

// ── Rate ──
export function loadRate(): number {
  try {
    const rate = Number(readLocal(RATE_KEY))
    return Number.isFinite(rate) && rate >= 0.5 && rate <= 3 ? rate : 1
  } catch { return 1 }
}
export function saveRate(r: number) {
  try { writeLocal(RATE_KEY, String(r)) } catch {}
}

// ── Sleep timer: last choice, minutes or end of chapter ──
export function loadSleepChoice(): number | 'chapter' | null {
  try {
    const v = readLocal(SLEEP_KEY)
    const minutes = Number(v)
    return v === 'chapter' ? v : Number.isFinite(minutes) && minutes > 0 ? minutes : null
  } catch { return null }
}
export function saveSleepChoice(c: number | 'chapter') {
  try { writeLocal(SLEEP_KEY, String(c)) } catch {}
}

// ── History ──
export interface HistoryEntry {
  slug: string
  title: string
  author: string
  chapterIdx: number
  timestamp: number
}

export function loadHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(readLocal(HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter(h => h
      && typeof h.slug === 'string' && typeof h.title === 'string' && typeof h.author === 'string'
      && Number.isInteger(h.chapterIdx) && h.chapterIdx >= 0
      && typeof h.timestamp === 'number' && Number.isFinite(h.timestamp)).slice(0, 50) : []
  } catch { return [] }
}

export function saveHistory(h: HistoryEntry[]) {
  try { writeLocal(HISTORY_KEY, JSON.stringify(h.slice(0, 50))) } catch {}
}

// ── Position: the chapter each book was listened to last ──
// (where in the chapter is kept by narration.ts)
export function loadPosition(slug: string): number {
  try {
    const val = readLocalRecord<number | { chapterIdx: number }>(POSITION_KEY)[slug]
    // Older versions stored { chapterIdx, charOffset }
    const idx = typeof val === 'number' ? val : val?.chapterIdx
    return Number.isInteger(idx) && idx >= 0 ? idx : 0
  } catch { return 0 }
}

export function savePosition(slug: string, chapterIdx: number) {
  try {
    const positions = readLocalRecord<number | { chapterIdx: number }>(POSITION_KEY)
    positions[slug] = chapterIdx
    writeLocal(POSITION_KEY, JSON.stringify(positions))
  } catch {}

  // Also update the history entry so My books shows the current chapter
  try {
    const history = loadHistory()
    const entry = history.find(h => h.slug === slug)
    if (entry) {
      entry.chapterIdx = chapterIdx
      entry.timestamp = Date.now()
      writeLocal(HISTORY_KEY, JSON.stringify(history))
    }
  } catch {}
}
