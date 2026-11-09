/**
 * Bookmarks, highlights and notes (books#11), kept on this device per book.
 * Offsets are chapter text offsets, like the read-along and the search.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'bp-annotations'

export const HIGHLIGHT_COLORS = {
  yellow: { label: 'Yellow', className: 'bg-yellow-300/50' },
  green: { label: 'Green', className: 'bg-green-300/50' },
  pink: { label: 'Pink', className: 'bg-pink-300/50' },
} as const
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS

export interface Annotation {
  id: string
  kind: 'bookmark' | 'highlight'
  chapterIdx: number
  /** Char range in the chapter; a bookmark is a point (start === end) */
  start: number
  end: number
  /** Narration time of a bookmark made while listening */
  seconds?: number
  color?: HighlightColor
  note?: string
  /** The highlighted text, or the sentence a bookmark is at (its name) */
  text: string
  created: number
}

type Store = Record<string, Annotation[]>

let store: Store = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
})()
const listeners = new Set<() => void>()

function update(slug: string, fn: (list: Annotation[]) => Annotation[]) {
  const list = fn(store[slug] ?? [])
  store = { ...store }
  if (list.length) store[slug] = list
  else delete store[slug]
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch {}
  for (const listener of listeners) listener()
}

export function addAnnotation(slug: string, a: Omit<Annotation, 'id' | 'created'>): Annotation {
  const full = { ...a, id: `${a.kind === 'bookmark' ? 'bm' : 'hl'}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: Date.now() }
  update(slug, list => [...list, full])
  return full
}

export function updateAnnotation(slug: string, id: string, patch: Partial<Pick<Annotation, 'color' | 'note'>>) {
  update(slug, list => list.map(a => (a.id === id ? { ...a, ...patch } : a)))
}

export function removeAnnotation(slug: string, id: string) {
  update(slug, list => list.filter(a => a.id !== id))
}

/** Every book's annotations, slug → list; re-renders on any change. */
export function useAllAnnotations(): Store {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => store,
  )
}

/** In reading order. */
export function sortAnnotations(list: Annotation[]): Annotation[] {
  return [...list].sort((a, b) => a.chapterIdx - b.chapterIdx || a.start - b.start)
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** The book's bookmarks, highlights and notes as Markdown. */
export function annotationsMarkdown(title: string, author: string, chapterTitles: string[], list: Annotation[]): string {
  const lines = [`# ${title}`, '', `*${author}* · bookmarks, highlights and notes`, '']
  let chapter = -1
  for (const a of sortAnnotations(list)) {
    if (a.chapterIdx !== chapter) {
      chapter = a.chapterIdx
      lines.push(`## ${chapterTitles[chapter] ?? `Chapter ${chapter + 1}`}`, '')
    }
    const text = a.text.replace(/\s+/g, ' ').trim()
    if (a.kind === 'bookmark') {
      lines.push(`- Bookmark${a.seconds !== undefined ? ` (${formatSeconds(a.seconds)} into the narration)` : ''}: ${text}`)
      if (a.note) lines.push(`  ${a.note.replace(/\n/g, '\n  ')}`)
    } else {
      lines.push(`> ${text}`)
      if (a.note) lines.push('', a.note)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Save the Markdown as a file. */
export function downloadMarkdown(filename: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
