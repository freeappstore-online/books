/**
 * Audio player persistence — all localStorage operations in one place.
 * Each function has its own try/catch so callers never crash on storage errors.
 */

import type { TtsEngine } from './useAudioPlayer'

// ── Keys ──
const HISTORY_KEY = 'bp-audio-history'
const POSITION_KEY = 'bp-audio-position'
const RATE_KEY = 'bp-audio-rate'
const VOICE_KEY = 'bp-audio-voice'
const ENGINE_KEY = 'bp-audio-engine'

// ── Rate ──
export function loadRate(): number {
  try { return Number(localStorage.getItem(RATE_KEY)) || 1 } catch { return 1 }
}
export function saveRate(r: number) {
  try { localStorage.setItem(RATE_KEY, String(r)) } catch {}
}

// ── Voice (browser TTS) ──
export function loadVoice(): string {
  try { return localStorage.getItem(VOICE_KEY) || '' } catch { return '' }
}
export function saveVoice(v: string) {
  try { localStorage.setItem(VOICE_KEY, v) } catch {}
}

// ── Engine ──
export function loadEngine(): TtsEngine {
  try { return (localStorage.getItem(ENGINE_KEY) as TtsEngine) || 'browser' } catch { return 'browser' }
}
export function saveEngine(e: TtsEngine) {
  try { localStorage.setItem(ENGINE_KEY, e) } catch {}
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

// ── Position (chapter + character offset per book) ──
export interface SavedPosition {
  chapterIdx: number
  charOffset: number
}

export function loadPosition(slug: string): SavedPosition {
  try {
    const positions = JSON.parse(localStorage.getItem(POSITION_KEY) || '{}')
    const val = positions[slug]
    if (typeof val === 'number') return { chapterIdx: val, charOffset: 0 } // legacy
    if (val && typeof val === 'object') return val as SavedPosition
    return { chapterIdx: 0, charOffset: 0 }
  } catch { return { chapterIdx: 0, charOffset: 0 } }
}

export function savePosition(slug: string, chapterIdx: number, charOffset: number) {
  try {
    const positions = JSON.parse(localStorage.getItem(POSITION_KEY) || '{}')
    positions[slug] = { chapterIdx, charOffset }
    localStorage.setItem(POSITION_KEY, JSON.stringify(positions))
  } catch {}

  // Also update history entry so Library tab shows current chapter
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
