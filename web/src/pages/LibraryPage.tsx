import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import {
  getLibrary,
  removeFromLibrary,
  LIBRARY_CHANGED_EVENT,
  BG_STATUS_EVENT,
  getBackgroundStatus,
  type BackgroundGenerationStatus,
  type LibraryBook,
} from '../hooks/useLibrary'
import { hasCachedAudio, cacheKey } from '../hooks/audioCache'
import { isMobileDevice, KOKORO_VOICES, useKokoroReady } from '../hooks/useKokoro'
import { CATALOG } from '../data/catalog'
import { isNarrated, loadPreparedManifest } from '../hooks/preparedAudio'

interface ChapterStatus {
  title: string
  localCached: boolean
}

interface LibraryBookDetail extends LibraryBook {
  chapterStatuses: ChapterStatus[]
  cachedCount: number
}

export function LibraryPage() {
  const [books, setBooks] = useState<LibraryBookDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundGenerationStatus>(getBackgroundStatus)
  const isMobile = isMobileDevice()
  const kokoroReady = useKokoroReady()

  const loadLibrary = useCallback(async function loadLibrary() {
    setLoading(true)
    // Local generation is offered only for narrated books for now (books#19)
    const manifest = await loadPreparedManifest()
    const lib = getLibrary().filter(book => isNarrated(manifest, book.slug))
    const detailed: LibraryBookDetail[] = []

    for (const book of lib) {
      let chapterTitles: string[] = []
      try {
        const res = await fetch(`/catalog/${book.slug}.json`)
        if (res.ok) {
          const data = await res.json() as { chapters: { title: string }[] }
          chapterTitles = data.chapters.map(c => c.title)
        }
      } catch {}

      const statuses: ChapterStatus[] = []
      for (let i = 0; i < book.totalChapters; i++) {
        const cached = await hasCachedAudio(cacheKey(book.slug, i, book.voiceId, book.version))
        statuses.push({
          title: chapterTitles[i] || `Chapter ${i + 1}`,
          localCached: cached,
        })
      }

      detailed.push({
        ...book,
        chapterStatuses: statuses,
        cachedCount: statuses.filter(s => s.localCached).length,
      })
    }

    setBooks(detailed)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  useEffect(() => {
    function handleLibraryChanged() {
      loadLibrary()
    }

    window.addEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
  }, [loadLibrary])

  useEffect(() => {
    function handleBackgroundStatus(event: Event) {
      const customEvent = event as CustomEvent<BackgroundGenerationStatus>
      setBackgroundStatus(customEvent.detail || getBackgroundStatus())
    }

    window.addEventListener(BG_STATUS_EVENT, handleBackgroundStatus)
    return () => window.removeEventListener(BG_STATUS_EVENT, handleBackgroundStatus)
  }, [])

  function handleRemove(slug: string) {
    removeFromLibrary(slug)
    setBooks(prev => prev.filter(b => b.slug !== slug))
  }

  const voiceLabel = (id: string) => KOKORO_VOICES.find(v => v.id === id)?.label || id

  return (
    <div className="min-h-dvh bg-page text-text">
      <NavBar title="Library" />

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-8">
        {/* Explainer */}
        <div className="bg-surface rounded-xl border border-border p-5 md:p-6 mb-6">
          <h2 className="text-lg font-display mb-3">AI Voice Library</h2>
          <div className="text-sm text-text-muted space-y-2">
            <p>
              Books in your library get AI-generated voice audio in the background.
              Once ready, chapters play instantly with natural-sounding AI voice.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <div className="bg-page rounded-lg p-3 text-center">
                <div className="text-accent text-lg mb-1">1</div>
                <div className="text-xs text-text-dim">Add a book from the reader</div>
              </div>
              <div className="bg-page rounded-lg p-3 text-center">
                <div className="text-accent text-lg mb-1">2</div>
                <div className="text-xs text-text-dim">Chapters generate while you browse</div>
              </div>
              <div className="bg-page rounded-lg p-3 text-center">
                <div className="text-accent text-lg mb-1">3</div>
                <div className="text-xs text-text-dim">Tap ✦ AI to play instantly</div>
              </div>
            </div>
            {isMobile && (
              <p className="text-warning text-xs mt-3">
                AI voice generation requires a desktop computer.
              </p>
            )}
            {!isMobile && !kokoroReady && (
              <p className="text-xs mt-3">
                <Link to="/settings" className="text-accent hover:underline">Download the AI model</Link> to generate new AI audio locally.
              </p>
            )}
          </div>
        </div>

        {(backgroundStatus.running || (books.length > 0 && backgroundStatus.message)) && (
          <div className={`rounded-xl p-4 mb-6 border ${
            backgroundStatus.running
              ? 'bg-accent/10 border-accent/30'
              : backgroundStatus.phase === 'error'
                ? 'bg-danger/10 border-danger/30'
                : 'bg-surface border-border'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-sm font-semibold ${
                  backgroundStatus.running
                    ? 'text-accent'
                    : backgroundStatus.phase === 'error'
                      ? 'text-danger'
                      : 'text-text'
                }`}>
                  {backgroundStatus.running ? 'Generating AI voice on this desktop' : 'Desktop AI generation status'}
                </div>
                <p className="text-sm text-text-muted mt-1">{backgroundStatus.message}</p>
              </div>
              <div className={`text-xs shrink-0 ${
                backgroundStatus.running ? 'text-accent' : 'text-text-dim'
              }`}>
                {backgroundStatus.running && backgroundStatus.chapter > 0 && backgroundStatus.total > 0
                  ? `${backgroundStatus.chapter}/${backgroundStatus.total}`
                  : backgroundStatus.running
                    ? 'Starting'
                    : backgroundStatus.phase.toUpperCase()}
              </div>
            </div>
            {backgroundStatus.running && backgroundStatus.total > 0 && (
              <div className="mt-3 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(6, Math.round((backgroundStatus.chapter / backgroundStatus.total) * 100))}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Library */}
        {loading ? (
          <p className="text-text-muted text-center py-12">Loading library...</p>
        ) : books.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">📚</div>
            <h3 className="font-display text-xl mb-2">Your library is empty</h3>
            <p className="text-text-muted text-sm mb-6">
              Open any book and tap "+ Add to Library" to queue it for AI voice generation.
            </p>
            <Link to="/" className="inline-block bg-accent hover:bg-accent-hover text-btn-text px-6 py-2.5 rounded-lg font-semibold transition text-sm">
              Browse Books
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {books.map(book => {
              const catalogBook = CATALOG.find(b => b.id === book.slug)
              const pct = book.totalChapters > 0 ? Math.round((book.cachedCount / book.totalChapters) * 100) : 0
              const isDone = book.cachedCount >= book.totalChapters
              const estimateMin = (book.totalChapters - book.cachedCount) * 2
              const isActiveBook = backgroundStatus.running && backgroundStatus.slug === book.slug

              return (
                <div key={book.slug + book.voiceId} className="bg-surface border border-border rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="p-4 md:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link to={`/read/${book.slug}`} className="font-display text-base md:text-lg hover:text-accent transition">
                          {book.title}
                        </Link>
                        <div className="text-xs text-text-muted mt-1">
                          {catalogBook?.author} · {voiceLabel(book.voiceId)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isDone ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success font-semibold">Ready</span>
                        ) : isActiveBook ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-accent/20 text-accent font-semibold">
                            Generating {backgroundStatus.chapter}/{backgroundStatus.total}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-accent/20 text-accent font-semibold">
                            {book.cachedCount}/{book.totalChapters}
                          </span>
                        )}
                        <button onClick={() => handleRemove(book.slug)} className="p-1.5 text-text-dim hover:text-danger transition" title="Remove">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3">
                      <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${isDone ? 'bg-success' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-xs text-text-dim">
                          {isDone
                            ? 'All chapters ready — instant AI playback'
                            : isActiveBook
                              ? backgroundStatus.message
                              : `~${estimateMin} min remaining`}
                        </span>
                        <span className="text-xs text-text-dim">{pct}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Chapter list */}
                  <div className="border-t border-border px-4 md:px-5 py-2 max-h-48 overflow-y-auto">
                    {book.chapterStatuses.map((ch, i) => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                          ch.localCached ? 'bg-success/20 text-success' : 'bg-surface-hover text-text-dim'
                        }`}>
                          {ch.localCached ? '✓' : '·'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs truncate">{ch.title}</div>
                          {ch.localCached && (
                            <div className="text-[11px] text-text-dim">Ready on this desktop</div>
                          )}
                        </div>
                        {ch.localCached && (
                          <Link to={`/read/${book.slug}`} className="text-xs text-accent hover:underline shrink-0">Play</Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
