import { useRef, useState } from 'react'
import { useAudioPlayer, RATES } from '../hooks/useAudioPlayer'
import { KOKORO_VOICES, KOKORO_LANGUAGES, isMobileDevice, useKokoroReady, usePreparedPosition, getPreparedTime } from '../hooks/useKokoro'
import { isNarrated, preparedCount, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'
import { useNavigate } from 'react-router-dom'
import { CATALOG } from '../data/catalog'

export function AudioPlayer() {
  const {
    book, playing, muted, chapterIdx, chapterOffset, rate, voiceName, voices, history,
    engine, kokoroLoading, kokoroGenerated, kokoroTotal, kokoroVoice, kokoroRuntime,
    play, pause, nextChapter, prevChapter, skip, seekAi, setRate, setVoiceName,
    setChapter, toggleMute, loadAndPlay, setEngine, setKokoroVoice,
  } = useAudioPlayer()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<'chapters' | 'history' | 'settings'>('chapters')
  const navigate = useNavigate()
  const kokoroReady = useKokoroReady()
  const manifest = usePreparedManifest()
  const position = usePreparedPosition()
  // Seek bar value while it is being dragged; seeking on every step would refetch the audio
  const [scrub, setScrub] = useState<number | null>(null)

  // Only narrated books can be listened to (books#19)
  if (!book || !manifest || !isNarrated(manifest, book.slug)) return null
  const narratedHistory = history.filter(h => isNarrated(manifest, h.slug))
  const hasPrepared = preparedCount(manifest, book.slug, kokoroVoice) > 0
  const kokoroUsable = hasPrepared || (kokoroReady && !isMobileDevice())

  const chapter = book.chapters[chapterIdx]
  const totalChapters = book.chapters.length

  // AI narration of this chapter can be seeked when it is prepared and the element plays it
  // (not a locally generated copy)
  const aiSeconds = engine === 'kokoro' ? manifest[kokoroVoice]?.[book.slug]?.[chapterIdx] : null
  const aiUrl = aiSeconds ? preparedUrl(book.slug, chapterIdx, kokoroVoice) : null
  const aiOnElement = position.url === aiUrl
  const aiSeekable = aiUrl !== null && (!playing || kokoroLoading || (aiOnElement && position.active))
  const aiDuration = (aiOnElement && position.duration) || aiSeconds || 0
  const aiTime = scrub ?? (aiUrl ? (aiOnElement ? position.time : getPreparedTime(aiUrl)) : 0)
  const canSkip = engine === 'browser' || aiSeekable
  const deviceFraction = chapter?.content.length ? chapterOffset / chapter.content.length : 0

  function commitScrub() {
    if (scrub === null) return
    seekAi(scrub)
    setScrub(null)
  }

  async function switchToBook(slug: string) {
    const catalogBook = CATALOG.find(b => b.id === slug)
    if (!catalogBook) return

    try {
      const res = await fetch(catalogBook.contentPath)
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
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface/95 backdrop-blur-sm">
      {/* Expanded panel */}
      {expanded && (
        <div className="border-b border-border px-4 py-3 max-w-4xl mx-auto max-h-64 overflow-y-auto">
          {/* Tabs */}
          <div className="flex gap-4 mb-3 border-b border-border pb-2">
            {(['chapters', 'history', 'settings'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-xs font-semibold uppercase tracking-wider transition ${
                  tab === t ? 'text-accent' : 'text-text-dim hover:text-text-muted'
                }`}
              >
                {t === 'chapters' ? `Chapters (${totalChapters})` : t === 'history' ? `Library (${narratedHistory.length})` : 'Settings'}
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

          {/* History / Library tab */}
          {tab === 'history' && (
            <div className="space-y-1">
              {narratedHistory.length === 0 ? (
                <p className="text-xs text-text-dim py-2">No listening history yet.</p>
              ) : (
                narratedHistory.map(h => (
                  <button
                    key={h.slug}
                    onClick={() => switchToBook(h.slug)}
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

          {/* Settings tab */}
          {tab === 'settings' && (
            <div className="space-y-3">
              {/* Engine toggle */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-dim">Engine</label>
                <div className="flex rounded-lg overflow-hidden border border-border">
                  <button
                    onClick={() => setEngine('browser')}
                    className={`px-3 py-1 text-xs transition ${
                      engine === 'browser' ? 'bg-accent text-btn-text font-semibold' : 'bg-page text-text-muted hover:text-text'
                    }`}
                  >
                    Browser
                  </button>
                  <button
                    onClick={() => kokoroUsable && setEngine('kokoro')}
                    disabled={!kokoroUsable}
                    className={`px-3 py-1 text-xs transition ${
                      engine === 'kokoro' ? 'bg-accent text-btn-text font-semibold'
                      : kokoroUsable ? 'bg-page text-text-muted hover:text-text'
                      : 'bg-page text-text-dim opacity-50 cursor-not-allowed'
                    }`}
                    title={hasPrepared ? 'AI narration' : isMobileDevice() ? 'Kokoro AI not available on mobile' : kokoroReady ? 'Kokoro AI voice' : 'Download the model in Settings first'}
                  >
                    Kokoro AI
                  </button>
                </div>
                {engine === 'kokoro' && kokoroLoading && (
                  <span className="text-xs text-accent animate-pulse">Generating...</span>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-text-dim">Speed</label>
                <select
                  value={rate}
                  onChange={e => setRate(Number(e.target.value))}
                  className="bg-page text-text text-xs rounded px-2 py-1 border border-border"
                >
                  {RATES.map(r => <option key={r} value={r}>{r}x</option>)}
                </select>

                {engine === 'browser' && voices.length > 1 && (
                  <>
                    <label className="text-xs text-text-dim">Voice</label>
                    <select
                      value={voiceName}
                      onChange={e => setVoiceName(e.target.value)}
                      className="bg-page text-text text-xs rounded px-2 py-1 border border-border max-w-40 truncate"
                    >
                      {voices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                    </select>
                  </>
                )}

                {engine === 'kokoro' && (
                  <>
                    <label className="text-xs text-text-dim">Voice</label>
                    <select
                      value={kokoroVoice}
                      onChange={e => setKokoroVoice(e.target.value)}
                      className="bg-page text-text text-xs rounded px-2 py-1 border border-border max-w-52"
                    >
                      {KOKORO_LANGUAGES.map(lang => (
                        <optgroup key={lang} label={lang}>
                          {KOKORO_VOICES.filter(v => v.langLabel === lang).map(v => (
                            <option key={v.id} value={v.id}>{v.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {engine === 'kokoro' && (
                <p className="text-xs text-text-dim">
                  AI voice — no word highlighting. Runtime: {kokoroRuntime.backend === 'unknown'
                    ? 'auto'
                    : `${kokoroRuntime.backend.toUpperCase()} · ${kokoroRuntime.dtype}`}. Manage in Account settings.
                </p>
              )}
              {!kokoroReady && engine === 'browser' && (
                <p className="text-xs text-text-dim">
                  Want better voices? Download Kokoro AI in your Account settings.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Buffer progress bar */}
      {engine === 'kokoro' && playing && kokoroTotal > 0 && kokoroGenerated < kokoroTotal && (
        <div className="h-0.5 bg-surface-hover">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${Math.round((kokoroGenerated / kokoroTotal) * 100)}%` }}
          />
        </div>
      )}

      {/* Chapter position */}
      {engine === 'kokoro' && aiSeekable ? (
        <div className="px-3 md:px-4 pt-2 max-w-4xl mx-auto flex items-center gap-2 text-[11px] tabular-nums text-text-dim">
          <span className="w-12 text-right">{formatTime(aiTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(aiDuration))}
            step={1}
            value={Math.min(aiTime, aiDuration)}
            onChange={e => setScrub(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            aria-label="Position in chapter"
            className="flex-1 h-1 accent-accent cursor-pointer"
          />
          <span className="w-12">-{formatTime(Math.max(0, aiDuration - aiTime))}</span>
        </div>
      ) : engine === 'browser' && (
        <div className="h-0.5 bg-surface-hover" role="progressbar" aria-label="Position in chapter"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(deviceFraction * 100)}>
          <div className="h-full bg-accent/60 transition-all duration-500" style={{ width: `${deviceFraction * 100}%` }} />
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
            {kokoroLoading ? (
              <span className="text-accent animate-pulse">Generating AI voice...</span>
            ) : engine === 'kokoro' && playing && kokoroGenerated < kokoroTotal ? (
              <span>
                {chapter?.title} · Ch {chapterIdx + 1}/{totalChapters} ·{' '}
                <span className="text-accent">Buffering {kokoroGenerated}/{kokoroTotal}</span>
              </span>
            ) : (
              <>
                {chapter?.title} · Ch {chapterIdx + 1}/{totalChapters}
                {engine === 'kokoro' && ` · AI${kokoroRuntime.backend !== 'unknown' ? ` · ${kokoroRuntime.backend.toUpperCase()}` : ''}`}
              </>
            )}
          </div>
        </button>

        {/* Controls */}
        <div className="flex items-center gap-0">
          <button onClick={prevChapter} disabled={chapterIdx === 0 || kokoroLoading}
            className="hidden sm:block p-2.5 text-text-muted hover:text-text disabled:opacity-30 transition" title="Previous chapter">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button onClick={() => skip(-15)} disabled={!canSkip}
            className="p-2 text-text-muted hover:text-text disabled:opacity-30 transition" title="Back 15 seconds" aria-label="Back 15 seconds">
            <SkipIcon seconds={15} back />
          </button>
          <button onClick={playing ? pause : play} disabled={kokoroLoading}
            className="p-2 w-11 h-11 rounded-full bg-accent text-btn-text hover:bg-accent-hover transition flex items-center justify-center disabled:opacity-70">
            {kokoroLoading ? (
              <div className="w-5 h-5 border-2 border-btn-text border-t-transparent rounded-full animate-spin" />
            ) : playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button onClick={() => skip(30)} disabled={!canSkip}
            className="p-2 text-text-muted hover:text-text disabled:opacity-30 transition" title="Forward 30 seconds" aria-label="Forward 30 seconds">
            <SkipIcon seconds={30} />
          </button>
          <button onClick={nextChapter} disabled={chapterIdx >= totalChapters - 1 || kokoroLoading}
            className="hidden sm:block p-2.5 text-text-muted hover:text-text disabled:opacity-30 transition" title="Next chapter">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z"/></svg>
          </button>
        </div>

        <SpeedButton rate={rate} setRate={setRate} />

        {/* Mute */}
        <button onClick={toggleMute}
          className={`hidden sm:block p-2.5 transition ${muted ? 'text-accent' : 'text-text-muted hover:text-text'}`}
          title={muted ? 'Unmute' : 'Mute'}>
          {muted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          )}
        </button>

        {/* Expand toggle */}
        <button onClick={() => setExpanded(!expanded)}
          className="p-2.5 text-text-muted hover:text-text transition">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
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
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressed = useRef(false)

  function cycle() {
    if (longPressed.current) { longPressed.current = false; return }
    setRate(QUICK_RATES.find(r => r > rate) ?? QUICK_RATES[0])
  }

  return (
    <div className="relative">
      <button
        onClick={cycle}
        onPointerDown={() => {
          longPressed.current = false
          pressTimer.current = setTimeout(() => { longPressed.current = true; setMenuOpen(true) }, 500)
        }}
        onPointerUp={() => clearTimeout(pressTimer.current)}
        onPointerLeave={() => clearTimeout(pressTimer.current)}
        onContextMenu={e => { e.preventDefault(); setMenuOpen(true) }}
        className="min-w-11 px-1.5 py-2 text-xs font-semibold tabular-nums text-text-muted hover:text-text transition select-none"
        title="Speed (hold for all speeds)"
        aria-label={`Speed ${rate}x`}
      >
        {rate}x
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div role="menu" className="absolute bottom-full right-0 mb-2 z-20 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1">
            {RATES.map(r => (
              <button
                key={r}
                role="menuitemradio"
                aria-checked={r === rate}
                onClick={() => { setRate(r); setMenuOpen(false) }}
                className={`block w-full px-4 py-1.5 text-left text-xs tabular-nums transition ${
                  r === rate ? 'text-accent font-semibold' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                {r}x
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SkipIcon({ seconds, back = false }: { seconds: number; back?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
