// Shared across all stores (DESIGN-SYSTEM.md §3) so the preference follows the user.
// index.html's pre-paint script reads the same key — keep the two in sync.
const KEY = 'stores-theme'

export type Theme = 'dark' | 'light' | 'sepia'

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light' || saved === 'sepia') return saved
  } catch {}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme) } catch {}
  applyTheme(theme)
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  const paper = getComputedStyle(root).getPropertyValue('--paper').trim()
  document.getElementById('theme-color')?.setAttribute('content', paper)
}

// Colours come from the [data-theme] tokens in index.css, so every theme uses the same utilities.
const TOKENS = { bg: 'bg-page', text: 'text-text', muted: 'text-text-muted', surface: 'bg-surface' }

export const THEME_STYLES: Record<Theme, { bg: string; text: string; muted: string; surface: string; label: string }> = {
  dark: { ...TOKENS, label: 'Dark' },
  light: { ...TOKENS, label: 'Light' },
  sepia: { ...TOKENS, label: 'Sepia' },
}
