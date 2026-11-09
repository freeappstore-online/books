import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { useReadAlong } from '../hooks/useAudioPlayer'
import type { CharRange } from '../hooks/readAlong'

// Room kept clear above and below the spoken line (the player bar is fixed at the bottom)
const TOP_MARGIN = 48
const BOTTOM_MARGIN = 140

/** Paragraphs that together are exactly `text`, so DOM text offsets stay chapter offsets. */
function splitBlocks(text: string): { start: number; end: number; text: string }[] {
  const blocks: { start: number; end: number; text: string }[] = []
  let start = 0
  const push = (end: number) => {
    blocks.push({ start, end, text: text.slice(start, end) })
    start = end
  }
  for (const m of text.matchAll(/\n\s*\n/g)) push(m.index + m[0].length)
  if (start < text.length) push(text.length)
  return blocks
}

/**
 * One paragraph. Highlight bounds are relative to the paragraph (empty when it
 * holds none), so a moving highlight re-renders only the paragraphs it enters or leaves.
 * A block of its own, so that change re-lays out one paragraph, not the whole chapter.
 */
const Block = memo(function Block({ text, s0, s1, w0, w1 }: { text: string; s0: number; s1: number; w0: number; w1: number }) {
  if (s0 >= s1 && w0 >= w1) return <span className="block">{text}</span>
  const cuts = [...new Set([0, s0, s1, w0, w1, text.length])]
    .filter(c => c >= 0 && c <= text.length)
    .sort((a, b) => a - b)
  const pieces = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]]
    const piece = text.slice(a, b)
    if (a >= w0 && b <= w1) {
      pieces.push(<mark key={a} data-readalong="word" className="bg-accent/35 text-inherit rounded-sm">{piece}</mark>)
    } else if (a >= s0 && b <= s1) {
      pieces.push(<span key={a} data-readalong="sentence" className="bg-accent/10 rounded-sm">{piece}</span>)
    } else {
      pieces.push(piece)
    }
  }
  return <span className="block">{pieces}</span>
})

function clip(range: CharRange | null, start: number, end: number): [number, number] {
  if (!range || range[1] <= start || range[0] >= end) return [0, 0]
  return [Math.max(range[0], start) - start, Math.min(range[1], end) - start]
}

interface Props {
  content: string
  chapterIdx: number
  /** This book is the one playing: show its read-along position when it is in this chapter */
  active: boolean
  className?: string
  style?: CSSProperties
  title?: string
  onClick?: (e: MouseEvent) => void
}

/** Chapter text that highlights the spoken word and sentence and keeps them in view. */
export function ChapterText({ content, chapterIdx, active, className, style, title, onClick }: Props) {
  const blocks = useMemo(() => splitBlocks(content), [content])
  const pos = useReadAlong()
  const hl = active && pos?.chapterIdx === chapterIdx ? pos : null
  const containerRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const hasHighlight = Boolean(hl)
  const hasHighlightRef = useRef(hasHighlight)
  hasHighlightRef.current = hasHighlight

  useEffect(() => { setFollowing(true) }, [chapterIdx])

  // Scrolling by hand stops following until "Follow audio" (or a click on the text)
  useEffect(() => {
    const stop = () => { if (hasHighlightRef.current) setFollowing(false) }
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) stop()
    }
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchmove', stop, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchmove', stop)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Keep the spoken line in view; scroll only once it leaves the comfortable area
  const target = hl?.word ?? hl?.sentence
  const targetStart = target?.[0] ?? -1
  useEffect(() => {
    if (!following || targetStart < 0) return
    const el = containerRef.current?.querySelector('[data-readalong="word"]')
      ?? containerRef.current?.querySelector('[data-readalong="sentence"]')
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.top >= TOP_MARGIN && rect.bottom <= window.innerHeight - BOTTOM_MARGIN) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [following, targetStart])

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        style={style}
        title={title}
        onClick={e => { setFollowing(true); onClick?.(e) }}
      >
        {blocks.map(({ start, end, text }) => {
          const [s0, s1] = clip(hl?.sentence ?? null, start, end)
          const [w0, w1] = clip(hl?.word ?? null, start, end)
          return <Block key={start} text={text} s0={s0} s1={s1} w0={w0} w1={w1} />
        })}
      </div>
      {hl && !following && (
        <button
          onClick={() => setFollowing(true)}
          className="fixed right-4 bottom-24 z-40 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-btn-text shadow-lg hover:bg-accent-hover transition"
        >
          Follow audio
        </button>
      )}
    </>
  )
}
