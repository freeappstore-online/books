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
  try {
    const v = Number(localStorage.getItem(key))
    return v ? clamp(v, range) : range.default
  } catch { return range.default }
}

function write(key: string, value: number) {
  try { localStorage.setItem(key, String(value)) } catch {}
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

/** Current value of a preference; updates when it changes anywhere in the app. */
function usePreference(get: () => number): number {
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

// Apply on load
applyUiScale(getUiScale())
