const KEY = 'bp-reading-progress'

interface ReadingProgress {
  chapterIdx: number
  totalChapters: number
  /** How far down the chapter the reader is, 0–1 */
  scroll?: number
  lastRead: number
}

function loadAll(): Record<string, ReadingProgress> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export function getProgress(slug: string): ReadingProgress | null {
  return loadAll()[slug] || null
}

export function getAllProgress(): Record<string, ReadingProgress> {
  return loadAll()
}

export function saveProgress(slug: string, chapterIdx: number, totalChapters: number, scroll = 0) {
  const all = loadAll()
  all[slug] = { chapterIdx, totalChapters, scroll, lastRead: Date.now() }
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch {}
}

export function getProgressPercent(slug: string): number {
  const p = getProgress(slug)
  if (!p || p.totalChapters <= 1) return 0
  return Math.round(((p.chapterIdx + 1) / p.totalChapters) * 100)
}
