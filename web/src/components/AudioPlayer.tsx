import { useEffect, useRef, useState } from 'react'
import { useAudioPlayer, RATES, type SleepChoice, type SleepTimer } from '../hooks/useAudioPlayer'
import { loadSleepChoice } from '../hooks/audioStorage'
import { getNarrationTime, primeNarration, useNarrationPosition } from '../hooks/narration'
import { chapterSeconds, isNarrated, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'
import { useNavigate } from 'react-router-dom'
import { CATALOG } from '../data/catalog'
import { fetchSavedOr, usePlayableManifest } from '../hooks/offlineBooks'

export function AudioPlayer() {
  const {
    book, playing, loading, error, chapterIdx, rate, history,
    play, pause, nextChapter, prevChapter, skip, seek, setRate,
    sleepTimer, startSleepTimer, extendSleepTimer, cancelSleepTimer,
    setChapter, loadAndPlay,
  } = useAudioPlayer()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<'chapters' | 'history'>('chapters')
  const navigate = useNavigate()
  const manifest = usePreparedManifest()
  // Offline, Recent lists only books saved on this device (books#24)
  const playable = usePlayableManifest()
  const position = useNarrationPosition()
  // Seek bar value while it is being dragged; seeking on every step would refetch the audio
  const [scrub, setScrub] = useState<number | null>(null)

  // Only narrated books can be listened to (books#19)
  if (!book || !manifest || !isNarrated(manifest, book.slug)) return null
  const narratedHistory = history.filter(h => playable && isNarrated(playable, h.slug))

  const chapter = book.chapters[chapterIdx]
  const totalChapters = book.chapters.length

  // The chapter can be seeked while stopped, and once the element plays it
  const seconds = chapterSeconds(manifest, book.slug, chapterIdx)
  const url = seconds ? preparedUrl(book.slug, chapterIdx) : null
  const onElement = position.url === url
  const seekable = url !== null && (!playing || loading || (onElement && position.active))
  const duration = (onElement && position.duration) || seconds || 0
  const time = scrub ?? (url ? (onElement ? position.time : getNarrationTime(url)) : 0)

  function commitScrub() {
    if (scrub === null) return
    seek(scrub)
    setScrub(null)
  }

  async function switchToBook(slug: string) {
    const catalogBook = CATALOG.find(b => b.id === slug)
    if (!catalogBook) return
    // The book's text loads before it plays: unlock the audio while this is still the tap (iOS)
    primeNarration()

    try {
      const res = await fetchSavedOr(catalogBook.contentPath)
      if (!res.ok) return
      const data = await res.json() as { chapters: { title: string; content: string }[] }
      const chapters = data.chapters.map((ch, i) => ({
        id: `ch-${i}`,
        title: ch.title,
        content: ch.content,
      }))
      loadAndPlay({ slug, title: catalogBook.title, author: catalogBook.author, chapters })
      navigate(`/read/${slug}`)
    } catch { /* ignore */ }
  }

  return (
    <div role="region" aria-label="Player" className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface/95 backdrop-blur-sm">
      {/* Expanded panel */}
      {expanded && (
        <div id="player-panel" className="border-b border-border px-4 py-3 max-w-4xl mx-auto max-h-64 overflow-y-auto">
          {/* Tabs */}
          <div className="flex gap-4 mb-3 border-b border-border pb-2">
            {(['chapters', 'history'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`text-xs font-semibold uppercase tracking-wider transition ${
                  tab === t ? 'text-accent' : 'text-text-dim hover:text-text-muted'
                }`}
              >
                {t === 'chapters' ? `Chapters (${totalChapters})` : `Recent (${narratedHistory.length})`}
              </button>
            ))}
          </div>

          {/* Chapters tab */}
          {tab === 'chapters' && (
            <div className="flex flex-wrap gap-1">
              {book.chapters.map((ch, i) => (
                <button
                  key={ch.id}
                  onClick={() => setChapter(i)}
                  aria-current={i === chapterIdx ? 'true' : undefined}
                  className={`px-2 py-1 text-xs rounded transition ${
                    i === chapterIdx
                      ? 'bg-accent text-btn-text font-semibold'
                      : 'bg-surface-hover text-text-muted hover:text-text'
                  }`}
                  title={ch.title}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}

          {/* Recently listened */}
          {tab === 'history' && (
            <div className="space-y-1">
              {narratedHistory.length === 0 ? (
                <p className="text-xs text-text-dim py-2">No listening history yet.</p>
              ) : (
                narratedHistory.map(h => (
                  <button
                    key={h.slug}
                    onClick={() => switchToBook(h.slug)}
                    aria-current={book.slug === h.slug ? 'true' : undefined}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between gap-2 ${
                      book.slug === h.slug ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate text-sm">{h.title}</div>
                      <div className="text-xs text-text-dim">{h.author} · Ch {h.chapterIdx + 1}</div>
                    </div>
                    {book.slug === h.slug && playing && (
                      <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Playback stopped by itself: connection lost, or not saved for offline */}
      <div role="status" className="max-w-4xl mx-auto px-3 md:px-4 text-xs text-warning empty:hidden pt-2">{error}</div>

      {/* Chapter position */}
      {seekable && (
        <div className="px-3 md:px-4 pt-2 max-w-4xl mx-auto flex items-center gap-2 text-[11px] tabular-nums text-text-dim">
          <span className="w-12 text-right" aria-hidden="true">{formatTime(time)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(duration))}
            step={1}
            value={Math.min(time, duration)}
            onChange={e => setScrub(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            aria-label="Position in chapter"
            aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
            className="flex-1 h-1 accent-accent cursor-pointer"
          />
          <span className="w-12" aria-hidden="true">-{formatTime(Math.max(0, duration - time))}</span>
        </div>
      )}

      {/* Main bar */}
      <div className="px-3 md:px-4 py-2 max-w-4xl mx-auto flex items-center gap-2 md:gap-3">
        {/* Book info */}
        <button
          onClick={() => navigate(`/read/${book.slug}`)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="text-sm font-semibold truncate">{book.title}</div>
          <div className="text-xs text-text-muted truncate">
            {chapter?.title} · Ch {chapterIdx + 1}/{totalChapters}
          </div>
        </button>

        {/* Controls */}
        <div className="flex items-center gap-0">
          <button onClick={prevChapter} disabled={chapterIdx === 0}
            className="hidden sm:block p-2.5 text-text-muted hover:text-text disabled:opacity-30 transition" title="Previous chapter (Shift+←)" aria-label="Previous chapter" aria-keyshortcuts="Shift+ArrowLeft">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button onClick={() => skip(-15)} disabled={!seekable}
            className="p-1.5 sm:p-2 text-text-muted hover:text-text disabled:opacity-30 transition" title="Back 15 seconds (←)" aria-label="Back 15 seconds" aria-keyshortcuts="ArrowLeft">
            <SkipIcon seconds={15} back />
          </button>
          <button onClick={playing ? pause : play}
            className="p-2 w-11 h-11 rounded-full bg-accent text-btn-text hover:bg-accent-hover transition flex items-center justify-center"
            title={playing ? 'Pause (Space)' : 'Resume (Space)'} aria-label={playing ? 'Pause' : 'Resume'} aria-keyshortcuts="Space K">
            {loading ? (
              <div className="w-5 h-5 border-2 border-btn-text border-t-transparent rounded-full animate-spin" />
            ) : playing ? (
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
            ) : (
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button onClick={() => skip(30)} disabled={!seekable}
            className="p-1.5 sm:p-2 text-text-muted hover:text-text disabled:opacity-30 transition" title="Forward 30 seconds (→)" aria-label="Forward 30 seconds" aria-keyshortcuts="ArrowRight">
            <SkipIcon seconds={30} />
          </button>
          <button onClick={nextChapter} disabled={chapterIdx >= totalChapters - 1}
            className="hidden sm:block p-2.5 text-text-muted hover:text-text disabled:opacity-30 transition" title="Next chapter (Shift+→)" aria-label="Next chapter" aria-keyshortcuts="Shift+ArrowRight">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z"/></svg>
          </button>
        </div>

        <SpeedButton rate={rate} setRate={setRate} />
        <SleepButton timer={sleepTimer} start={startSleepTimer} extend={extendSleepTimer} cancel={cancelSleepTimer} />

        {/* Expand toggle */}
        <button onClick={() => setExpanded(!expanded)}
          className="p-2 sm:p-2.5 text-text-muted hover:text-text transition"
          aria-expanded={expanded} aria-controls="player-panel"
          aria-label={expanded ? 'Hide chapters' : 'Show chapters'}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            {expanded
              ? <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
              : <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
            }
          </svg>
        </button>
      </div>
    </div>
  )
}

/** Speeds a tap cycles through; long-press or right-click lists every rate. */
const QUICK_RATES = [0.75, 1, 1.25, 1.5, 2]

function SpeedButton({ rate, setRate }: { rate: number; setRate: (r: number) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = () => { setMenuOpen(false); buttonRef.current?.focus() }
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressed = useRef(false)

  function cycle() {
    if (longPressed.current) { longPressed.current = false; return }
    setRate(QUICK_RATES.find(r => r > rate) ?? QUICK_RATES[0])
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={cycle}
        onPointerDown={() => {
          longPressed.current = false
          pressTimer.current = setTimeout(() => { longPressed.current = true; setMenuOpen(true) }, 500)
        }}
        onPointerUp={() => clearTimeout(pressTimer.current)}
        onPointerLeave={() => clearTimeout(pressTimer.current)}
        onContextMenu={e => { e.preventDefault(); setMenuOpen(true) }}
        className="min-w-9 sm:min-w-11 px-1 sm:px-1.5 py-2 text-xs font-semibold tabular-nums text-text-muted hover:text-text transition select-none"
        title="Speed (hold for all speeds; [ and ] step it)"
        aria-label={`Speed ${rate}x`}
        aria-keyshortcuts="[ ]"
      >
        {rate}x
      </button>
      {menuOpen && (
        <BarMenu label="Speed" onClose={close}>
          {RATES.map(r => (
            <MenuItem key={r} checked={r === rate} onClick={() => { setRate(r); close() }}>
              {r}x
            </MenuItem>
          ))}
        </BarMenu>
      )}
    </div>
  )
}

const SLEEP_CHOICES: SleepChoice[] = [5, 15, 30, 45, 60, 'chapter']

const sleepLabel = (c: SleepChoice) => c === 'chapter' ? 'End of chapter' : `${c} minutes`

/** Moon button: picks a sleep timer, then shows its countdown; tapping that cancels or extends it. */
function SleepButton({ timer, start, extend, cancel }: {
  timer: SleepTimer | null
  start: (c: SleepChoice) => void
  extend: (minutes: number) => void
  cancel: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const last = menuOpen ? loadSleepChoice() : null
  const close = () => { setMenuOpen(false); buttonRef.current?.focus() }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`flex items-center gap-1 p-1.5 sm:p-2 text-xs font-semibold tabular-nums transition ${timer ? 'text-accent' : 'text-text-muted hover:text-text'}`}
        title="Sleep timer"
        aria-label={timer ? `Sleep timer: ${timer.choice === 'chapter' ? 'end of chapter' : formatTime(timer.remaining / 1000)}` : 'Sleep timer'}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.3 2a10 10 0 1 0 9.7 12.6A8 8 0 0 1 12.3 2z"/></svg>
        {timer && <span>{timer.choice === 'chapter' ? 'Ch' : formatTime(timer.remaining / 1000)}</span>}
      </button>
      {menuOpen && (
        <BarMenu label="Sleep timer" onClose={close}>
          {timer && timer.choice !== 'chapter' && (
            <>
              <MenuItem onClick={() => { extend(5); close() }}>+5 minutes</MenuItem>
              <MenuItem onClick={() => { extend(15); close() }}>+15 minutes</MenuItem>
            </>
          )}
          {timer && <MenuItem onClick={() => { cancel(); close() }}>Turn off timer</MenuItem>}
          {timer && <div role="separator" className="my-1 border-t border-border" />}
          {SLEEP_CHOICES.map(c => (
            <MenuItem key={c} checked={timer ? timer.choice === c : last === c} onClick={() => { start(c); close() }}>
              {sleepLabel(c)}
            </MenuItem>
          ))}
        </BarMenu>
      )}
    </div>
  )
}

/**
 * Popover above a bar button; a click outside closes it. Keyboard (books#15): focus moves
 * into it, arrows/Home/End move between items, Escape or Tab closes it (onClose returns focus).
 */
function BarMenu({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const menu = menuRef.current
    ;(menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus()
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (j: number) => items[(j + items.length) % items.length]?.focus()
    const keys: Record<string, () => void> = {
      Escape: onClose, Tab: onClose,
      ArrowDown: () => go(i + 1), ArrowUp: () => go(i - 1), Home: () => go(0), End: () => go(items.length - 1),
    }
    if (!keys[e.key]) return
    e.preventDefault()
    keys[e.key]()
  }

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div ref={menuRef} role="menu" aria-label={label} onKeyDown={onKeyDown} className="absolute bottom-full right-0 mb-2 z-20 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1">
        {children}
      </div>
    </>
  )
}

function MenuItem({ checked, onClick, children }: { checked?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      tabIndex={-1}
      aria-checked={checked}
      onClick={onClick}
      className={`block w-full whitespace-nowrap px-4 py-1.5 text-left text-xs tabular-nums transition ${
        checked ? 'text-accent font-semibold' : 'text-text-muted hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function SkipIcon({ seconds, back = false }: { seconds: number; back?: boolean }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <g transform={back ? undefined : 'translate(24 0) scale(-1 1)'}>
        <path d="M4 12a8 8 0 1 0 2.5-5.8" />
        <path d="M4 3v4h4" />
      </g>
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">{seconds}</text>
    </svg>
  )
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
