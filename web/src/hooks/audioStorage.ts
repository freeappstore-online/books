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
  try { return Number(localStorage.getItem(RATE_KEY)) || 1 } catch { return 1 }
}
export function saveRate(r: number) {
  try { localStorage.setItem(RATE_KEY, String(r)) } catch {}
}

// ── Sleep timer: last choice, minutes or end of chapter ──
export function loadSleepChoice(): number | 'chapter' | null {
  try {
    const v = localStorage.getItem(SLEEP_KEY)
    return v === 'chapter' ? v : Number(v) || null
  } catch { return null }
}
export function saveSleepChoice(c: number | 'chapter') {
  try { localStorage.setItem(SLEEP_KEY, String(c)) } catch {}
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
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}

export function saveHistory(h: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))) } catch {}
}

// ── Position: the chapter each book was listened to last ──
// (where in the chapter is kept by narration.ts)
export function loadPosition(slug: string): number {
  try {
    const val = JSON.parse(localStorage.getItem(POSITION_KEY) || '{}')[slug]
    // Older versions stored { chapterIdx, charOffset }
    return (typeof val === 'number' ? val : val?.chapterIdx) || 0
  } catch { return 0 }
}

export function savePosition(slug: string, chapterIdx: number) {
  try {
    const positions = JSON.parse(localStorage.getItem(POSITION_KEY) || '{}')
    positions[slug] = chapterIdx
    localStorage.setItem(POSITION_KEY, JSON.stringify(positions))
  } catch {}

  // Also update the history entry so My books shows the current chapter
  try {
    const history: HistoryEntry[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    const entry = history.find(h => h.slug === slug)
    if (entry) {
      entry.chapterIdx = chapterIdx
      entry.timestamp = Date.now()
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    }
  } catch {}
}
