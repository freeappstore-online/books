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

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  const paper = getComputedStyle(root).getPropertyValue('--paper').trim()
  document.getElementById('theme-color')?.setAttribute('content', paper)
}
