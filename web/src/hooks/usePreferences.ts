import { readLocal, writeLocal } from './localStorage'
import { useEffect, useState } from 'react'

const READER_FONT_KEY = 'bp-font-size'
const UI_SCALE_KEY = 'bp-ui-scale'
const CHANGED_EVENT = 'bp-preferences-changed'

/** Book text size in px. */
export const BOOK_TEXT = { min: 14, max: 32, step: 1, default: 17 }
/** Interface text size in % of the browser default; book text is not affected. */
export const UI_TEXT = { min: 80, max: 150, step: 5, default: 100 }

const clamp = (v: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, v))

function read(key: string, range: typeof BOOK_TEXT): number {
  const v = Number(readLocal(key))
  return v ? clamp(v, range) : range.default
}

function write(key: string, value: number | boolean) {
  writeLocal(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

export function getReaderFontSize(): number { return read(READER_FONT_KEY, BOOK_TEXT) }
export function setReaderFontSize(size: number) { write(READER_FONT_KEY, clamp(size, BOOK_TEXT)) }

export function getUiScale(): number { return read(UI_SCALE_KEY, UI_TEXT) }
export function setUiScale(scale: number) {
  const v = clamp(scale, UI_TEXT)
  applyUiScale(v)
  write(UI_SCALE_KEY, v)
}

export function applyUiScale(scale: number) {
  document.documentElement.style.fontSize = `${scale}%`
}

// ── Listening (books#37) ──
const TITLES_KEY = 'bp-read-titles'
const PAUSE_KEY = 'bp-chapter-pause'
const CONTINUE_KEY = 'bp-continue-chapters'
const BOOST_KEY = 'bp-volume-boost'

/** Seconds of silence between chapters on auto-advance; 0 is off. */
export const CHAPTER_PAUSES = [0, 1.5, 3, 5]
const DEFAULT_PAUSE = 1.5

function readFlag(key: string, fallback: boolean): boolean {
  const v = readLocal(key)
  return v === '1' ? true : v === '0' ? false : fallback
}

/** Play a chapter's spoken title before it, when one is published. */
export function getReadTitles(): boolean { return readFlag(TITLES_KEY, true) }
export function setReadTitles(on: boolean) { write(TITLES_KEY, on) }

export function getChapterPause(): number {
  const v = Number(readLocal(PAUSE_KEY) || NaN)
  return CHAPTER_PAUSES.includes(v) ? v : DEFAULT_PAUSE
}
export function setChapterPause(seconds: number) { write(PAUSE_KEY, seconds) }

/** Off: stop at the end of each chapter. */
export function getContinueChapters(): boolean { return readFlag(CONTINUE_KEY, true) }
export function setContinueChapters(on: boolean) { write(CONTINUE_KEY, on) }

/** Louder playback; applied by narration.ts, set through the player (useAudioPlayer). */
export function getVolumeBoost(): boolean { return readFlag(BOOST_KEY, false) }
export function setVolumeBoostPref(on: boolean) { write(BOOST_KEY, on) }

/** Current value of a preference; updates when it changes anywhere in the app. */
function usePreference<T>(get: () => T): T {
  const [value, setValue] = useState(get)
  useEffect(() => {
    const update = () => setValue(get())
    window.addEventListener(CHANGED_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(CHANGED_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [get])
  return value
}

export const useReaderFontSize = () => usePreference(getReaderFontSize)
export const useUiScale = () => usePreference(getUiScale)
export const useReadTitles = () => usePreference(getReadTitles)
export const useChapterPause = () => usePreference(getChapterPause)
export const useContinueChapters = () => usePreference(getContinueChapters)
export const useVolumeBoost = () => usePreference(getVolumeBoost)
