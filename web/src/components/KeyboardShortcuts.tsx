import { useEffect, useRef } from 'react'
import { useAudioPlayer, RATES } from '../hooks/useAudioPlayer'

/**
 * App-wide keyboard shortcuts (books#15) and the "?" help listing them.
 * Pages opt controls in with data-shortcut: "play" (starts listening when nothing is
 * loaded yet), "follow" (Follow audio) and "search" (the page's search field, for "/").
 */
const SHORTCUTS: [string[], string][] = [
  [['Space', 'K'], 'Play or pause'],
  [['←'], 'Back 15 seconds'],
  [['→'], 'Forward 30 seconds'],
  [['Shift', '←'], 'Previous chapter'],
  [['Shift', '→'], 'Next chapter'],
  [['['], 'Slower'],
  [[']'], 'Faster'],
  [['F'], 'Follow the audio in the text'],
  [['/'], 'Search'],
  [['?'], 'Show these shortcuts'],
]

export function KeyboardShortcuts() {
  const player = useAudioPlayer()
  const playerRef = useRef(player)
  playerRef.current = player
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const click = (name: string) => document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`)?.click()

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      // Typing, a slider, a select or an open menu or dialog keeps its keys
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], dialog')) return
      const p = playerRef.current
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      let handled = true
      if (key === ' ' || key === 'k') {
        // Space on a focused button or link activates it instead
        if (key === ' ' && target.closest('button, a, [role="button"]')) return
        if (p.book) {
          if (p.playing) p.pause()
          else p.play()
        } else {
          click('play')
        }
      } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && p.book) {
        const forward = key === 'ArrowRight'
        if (e.shiftKey) {
          if (forward) p.nextChapter()
          else p.prevChapter()
        } else {
          p.skip(forward ? 30 : -15)
        }
      } else if ((key === '[' || key === ']') && p.book) {
        const i = RATES.indexOf(p.rate)
        const next = RATES[Math.min(RATES.length - 1, Math.max(0, (i < 0 ? RATES.indexOf(1) : i) + (key === ']' ? 1 : -1)))]
        p.setRate(next)
      } else if (key === 'f') {
        click('follow')
      } else if (key === '/') {
        const search = document.querySelector<HTMLElement>('[data-shortcut="search"]')
        if (search) search.focus()
        else handled = false
      } else if (key === '?') {
        dialogRef.current?.showModal()
      } else {
        handled = false
      }
      if (handled) e.preventDefault()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-title"
      className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-text shadow-xl backdrop:bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) dialogRef.current?.close() }}
      // A modal: Close is its only control, so Tab stays on it rather than leaving the page
      onKeyDown={e => { if (e.key === 'Tab') e.preventDefault() }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="shortcuts-title" className="text-lg font-display">Keyboard shortcuts</h2>
        <button
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg px-2 py-1 text-sm text-text-muted hover:bg-surface-hover hover:text-text transition"
        >
          Close
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={what} className="contents">
            <dt className="whitespace-nowrap">
              {keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="text-text-muted">{keys[0] === 'Shift' ? ' + ' : ' or '}</span>}
                  <kbd className="rounded border border-border bg-page px-1.5 py-0.5 font-code text-xs">{k}</kbd>
                </span>
              ))}
            </dt>
            <dd className="text-text-muted">{what}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  )
}
