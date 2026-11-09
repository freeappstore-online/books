import { useState } from 'react'
import {
  HIGHLIGHT_COLORS, formatSeconds, removeAnnotation, sortAnnotations, updateAnnotation,
  type Annotation, type HighlightColor,
} from '../hooks/annotations'

export function BookmarkIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  )
}

/** Delete, asking first when there is a note to lose. */
function deleteAnnotation(slug: string, a: Annotation): boolean {
  if (a.note && !window.confirm('Delete this note?')) return false
  removeAnnotation(slug, a.id)
  return true
}

/** A book's bookmarks and highlights in reading order: go to, edit, delete (books#11). */
export function AnnotationList({ slug, list, chapterTitles, onJump }: {
  slug: string
  list: Annotation[]
  chapterTitles: string[]
  onJump: (a: Annotation) => void
}) {
  const [editing, setEditing] = useState<Annotation | null>(null)
  const link = 'text-xs text-text-muted hover:text-text transition'

  return (
    <>
      <ol className="divide-y divide-border">
        {sortAnnotations(list).map(a => (
          <li key={a.id} className="py-2.5 flex gap-3">
            <span className="mt-1 shrink-0 text-accent">
              {a.kind === 'bookmark'
                ? <BookmarkIcon size={14} />
                : <span className={`block w-3.5 h-3.5 rounded-full ${HIGHLIGHT_COLORS[a.color ?? 'yellow'].className}`} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-text-dim truncate">
                {chapterTitles[a.chapterIdx] ?? `Chapter ${a.chapterIdx + 1}`}
                {a.seconds !== undefined && ` · ${formatSeconds(a.seconds)}`}
                {a.stale && <span className="text-warning"> · Text changed</span>}
              </div>
              <button onClick={() => onJump(a)} className="block w-full text-left text-sm text-text-muted hover:text-text transition line-clamp-3">
                {a.kind === 'highlight' ? `“${a.text}”` : a.text}
              </button>
              {a.note && <p className="mt-1 text-sm italic text-text whitespace-pre-wrap">{a.note}</p>}
              <div className="mt-1 flex gap-4">
                <button onClick={() => onJump(a)} className={link}>Go to</button>
                <button onClick={() => setEditing(a)} className={link}>{a.note ? 'Edit' : 'Add note'}</button>
                <button onClick={() => deleteAnnotation(slug, a)} className="text-xs text-text-muted hover:text-danger transition">Delete</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {editing && <AnnotationEditor slug={slug} annotation={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/**
 * Offered under selected chapter text: highlight it in a colour, or with a note.
 * Below the selection, clear of the phone's own selection menu above it.
 */
export function HighlightToolbar({ rect, onHighlight }: { rect: DOMRect; onHighlight: (color: HighlightColor, withNote: boolean) => void }) {
  const width = 240
  const height = 60
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)
  // Below the selection, clear of the iOS/Android selection handle (touch) and of the iOS edit
  // menu, which sits above it; above the selection instead when the fixed player is in the way
  const gap = matchMedia('(pointer: coarse)').matches ? 32 : 8
  const player = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-h')) || 0
  const limit = window.innerHeight - player - height
  const top = rect.bottom + gap <= limit ? rect.bottom + gap : Math.max(8, Math.min(limit, rect.top - gap - height))
  return (
    <div
      role="toolbar"
      aria-label="Highlight"
      // Keep the selection while pressing the buttons
      onMouseDown={e => e.preventDefault()}
      className="fixed z-50 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 shadow-xl"
      style={{ left, top, width }}
    >
      {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map(c => (
        <button
          key={c}
          onClick={() => onHighlight(c, false)}
          aria-label={`Highlight ${HIGHLIGHT_COLORS[c].label.toLowerCase()}`}
          title={`Highlight ${HIGHLIGHT_COLORS[c].label.toLowerCase()}`}
          className={`w-9 h-9 rounded-full border border-border ${HIGHLIGHT_COLORS[c].className}`}
        />
      ))}
      <button onClick={() => onHighlight('yellow', true)} className="ml-auto min-h-10 px-2 text-sm font-semibold text-accent hover:text-accent-hover transition">
        Note
      </button>
    </div>
  )
}

/** Colour and note of a highlight, or the note of a bookmark. */
export function AnnotationEditor({ slug, annotation, onClose }: { slug: string; annotation: Annotation; onClose: () => void }) {
  const [note, setNote] = useState(annotation.note ?? '')
  const [color, setColor] = useState<HighlightColor>(annotation.color ?? 'yellow')
  const save = () => {
    updateAnnotation(slug, annotation.id, annotation.kind === 'highlight' ? { note: note.trim() || undefined, color } : { note: note.trim() || undefined })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={annotation.kind === 'highlight' ? 'Edit highlight' : 'Edit bookmark'}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-xl text-left"
      >
        <p className="text-sm text-text-muted line-clamp-4 mb-3">
          {annotation.kind === 'highlight' ? `“${annotation.text}”` : annotation.text}
        </p>
        {annotation.kind === 'highlight' && (
          <div className="flex items-center gap-2 mb-3" role="radiogroup" aria-label="Highlight colour">
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map(c => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={HIGHLIGHT_COLORS[c].label}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 ${HIGHLIGHT_COLORS[c].className} ${color === c ? 'border-text' : 'border-transparent'}`}
              />
            ))}
          </div>
        )}
        <textarea
          autoFocus
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note"
          aria-label="Note"
          rows={4}
          className="w-full bg-page border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim focus:outline-none focus:border-accent transition"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            onClick={() => { if (deleteAnnotation(slug, annotation)) onClose() }}
            className="text-sm text-text-muted hover:text-danger transition"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm border border-border text-text-muted hover:text-text transition">Cancel</button>
            <button onClick={save} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent hover:bg-accent-hover text-btn-text transition">Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
