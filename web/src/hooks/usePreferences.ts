const READER_FONT_KEY = 'bp-font-size'
const UI_SCALE_KEY = 'bp-ui-scale'

export const READER_FONTS = [
  { label: 'Small', value: 15 },
  { label: 'Default', value: 17 },
  { label: 'Large', value: 19 },
  { label: 'X-Large', value: 22 },
  { label: 'XX-Large', value: 26 },
]

export const UI_SCALES = [
  { label: 'Compact', value: 90 },
  { label: 'Default', value: 100 },
  { label: 'Large', value: 110 },
  { label: 'X-Large', value: 120 },
  { label: 'XX-Large', value: 130 },
]

export function getReaderFontSize(): number {
  try { return Number(localStorage.getItem(READER_FONT_KEY)) || 17 } catch { return 17 }
}

export function setReaderFontSize(size: number) {
  localStorage.setItem(READER_FONT_KEY, String(size))
}

export function getUiScale(): number {
  try { return Number(localStorage.getItem(UI_SCALE_KEY)) || 100 } catch { return 100 }
}

export function setUiScaleValue(scale: number) {
  localStorage.setItem(UI_SCALE_KEY, String(scale))
}

export function applyUiScale(scale: number) {
  document.documentElement.style.fontSize = `${scale}%`
}

// Apply on load
applyUiScale(getUiScale())
