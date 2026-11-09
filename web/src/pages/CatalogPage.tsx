import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CATALOG, GENRES, ALL_TAGS, type CatalogBook } from '../data/catalog'
import { BookCover } from '../components/BookCover'
import { NavBar } from '../components/NavBar'
import { getAllProgress, getProgressPercent } from '../hooks/useReadingProgress'
import { getLibrary, LIBRARY_CHANGED_EVENT, type LibraryBook } from '../hooks/useLibrary'
import { isMobileDevice, useKokoroReady } from '../hooks/useKokoro'

interface AiBookState {
  inLibrary: boolean
  generatedCount: number
  readyCount: number
}

export function CatalogPage() {
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string>('')
  const [tag, setTag] = useState<string>('')
  const [sort, setSort] = useState<'title' | 'author' | 'year'>('title')
  const [library, setLibrary] = useState<LibraryBook[]>(() => getLibrary())

  useEffect(() => {
    function handleLibraryChanged() {
      setLibrary(getLibrary())
    }

    window.addEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
  }, [])

  const libraryBySlug = useMemo(() => {
    const map = new Map<string, LibraryBook>()
    for (const entry of library) {
      if (!map.has(entry.slug)) map.set(entry.slug, entry)
    }
    return map
  }, [library])

  const catalogWithAi = useMemo(() => {
    return CATALOG.map(book => ({
      book,
      ai: getAiBookState(libraryBySlug.get(book.id)),
    }))
  }, [libraryBySlug])

  const filtered = useMemo(() => {
    let books = [...catalogWithAi]

    if (search) {
      const q = search.toLowerCase()
      books = books.filter(({ book }) =>
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        book.genre.toLowerCase().includes(q) ||
        book.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    if (genre) books = books.filter(({ book }) => book.genre === genre)
    if (tag) books = books.filter(({ book }) => book.tags.includes(tag))

    books.sort((a, b) => {
      if (sort === 'year') return a.book.year - b.book.year
      return a.book[sort].localeCompare(b.book[sort])
    })

    return books
  }, [catalogWithAi, search, genre, tag, sort])

  const featured = catalogWithAi.slice(0, 4)
  const aiReadyNow = useMemo(
    () => catalogWithAi
      .filter(({ ai }) => ai.readyCount > 0)
      .sort((a, b) => {
        const aComplete = a.ai.readyCount >= a.book.chapters ? 1 : 0
        const bComplete = b.ai.readyCount >= b.book.chapters ? 1 : 0
        if (aComplete !== bComplete) return bComplete - aComplete
        return b.ai.readyCount - a.ai.readyCount
      })
      .slice(0, 4),
    [catalogWithAi],
  )
  const queuedOnDesktop = useMemo(
    () => catalogWithAi
      .filter(({ ai }) => ai.inLibrary)
      .sort((a, b) => b.ai.generatedCount - a.ai.generatedCount)
      .slice(0, 4),
    [catalogWithAi],
  )

  const totalReadyBooks = catalogWithAi.filter(({ book, ai }) => ai.readyCount >= book.chapters).length
  const totalReadyChapters = catalogWithAi.reduce((sum, { ai }) => sum + ai.readyCount, 0)
  const isDesktop = !isMobileDevice()
  const kokoroReady = useKokoroReady()

  return (
    <div className="min-h-dvh bg-page text-text">
      <NavBar />

      <section className="px-4 md:px-6 py-10 md:py-16 max-w-6xl mx-auto">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-display leading-tight mb-3 md:mb-4">
              Discover Books,<br />
              <span className="text-accent italic">Now With AI Voice</span>
            </h1>
            <p className="text-base md:text-xl text-text-muted max-w-2xl mb-6 md:mb-8">
              Browse the catalog, listen with your browser's voice right away, and let your desktop generate natural AI voice in the background for offline listening.
            </p>

            <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:gap-3 mb-4">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search books, authors, genres, topics..."
                className="w-full md:flex-1 md:min-w-64 bg-surface border border-border rounded-lg px-4 py-3 text-text placeholder-text-dim focus:outline-none focus:border-accent transition"
              />
              <div className="flex gap-2">
                <select
                  value={genre}
                  onChange={e => setGenre(e.target.value)}
                  className="flex-1 md:flex-none bg-surface border border-border rounded-lg px-3 py-3 text-text text-sm"
                >
                  <option value="">All Genres</option>
                  {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as 'title' | 'author' | 'year')}
                  className="flex-1 md:flex-none bg-surface border border-border rounded-lg px-3 py-3 text-text text-sm"
                >
                  <option value="title">By Title</option>
                  <option value="author">By Author</option>
                  <option value="year">By Year</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {tag && (
                <button
                  onClick={() => setTag('')}
                  className="text-xs px-3 py-1 rounded-full bg-accent text-btn-text font-semibold"
                >
                  {tag} &times;
                </button>
              )}
              {ALL_TAGS.filter(t => t !== tag).slice(0, 12).map(t => (
                <button
                  key={t}
                  onClick={() => setTag(t)}
                  className="text-xs px-3 py-1 rounded-full border border-border text-text-muted hover:border-accent hover:text-accent transition"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-2xl p-5 md:p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-dim mb-4">Desktop AI Voice</div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <StatCard label="Books AI-ready" value={String(totalReadyBooks)} />
              <StatCard label="AI chapters" value={String(totalReadyChapters)} />
              <StatCard label="Queued here" value={String(library.length)} />
              <StatCard label="Desktop status" value={isDesktop ? (kokoroReady ? 'Ready' : 'Model needed') : 'Mobile'} />
            </div>

            <div className="text-sm text-text-muted space-y-2">
              {isDesktop && !kokoroReady && (
                <p>Download the Kokoro model in Settings to generate AI voice locally.</p>
              )}
              {isDesktop && kokoroReady && (
                <p>Your desktop can queue books in Library and generate chapters in the background, cached for offline playback.</p>
              )}
              {!isDesktop && (
                <p>AI voice generation requires a desktop computer.</p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/library" className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-btn-text transition hover:bg-accent-hover">
                Open Library Queue
              </Link>
              {!kokoroReady && isDesktop && (
                <Link to="/settings" className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm text-text-muted transition hover:border-accent hover:text-text">
                  Get AI Model
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {!search && !genre && !tag && (() => {
        const progress = getAllProgress()
        const inProgress = CATALOG
          .filter(b => progress[b.id] && progress[b.id].chapterIdx < progress[b.id].totalChapters - 1)
          .sort((a, b) => (progress[b.id]?.lastRead || 0) - (progress[a.id]?.lastRead || 0))
          .slice(0, 4)
        if (inProgress.length === 0) return null
        return (
          <section className="px-4 md:px-6 pb-8 md:pb-10 max-w-6xl mx-auto">
            <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4 md:mb-6">Continue Reading</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              {inProgress.map(book => {
                const pct = getProgressPercent(book.id)
                const ai = catalogWithAi.find(entry => entry.book.id === book.id)?.ai
                return (
                  <Link key={book.id} to={`/read/${book.id}`} className="group">
                    <BookCover book={book} size="lg" />
                    <div className="mt-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="h-1 bg-surface-hover rounded-full overflow-hidden">
                          <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-text-dim">{pct}% complete</p>
                      </div>
                      {ai && <AiStatusPills ai={ai} totalChapters={book.chapters} compact />}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })()}

      {!search && !genre && !tag && aiReadyNow.length > 0 && (
        <section className="px-4 md:px-6 pb-10 md:pb-12 max-w-6xl mx-auto">
          <div className="flex items-end justify-between gap-3 mb-4 md:mb-6">
            <div>
              <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider">Ready To Listen In AI</h2>
              <p className="mt-1 text-sm text-text-muted">These books already have AI audio cached on this device.</p>
            </div>
            <Link to="/library" className="hidden md:inline text-sm text-accent hover:underline">Open Library</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {aiReadyNow.map(({ book, ai }) => (
              <Link key={book.id} to={`/read/${book.id}`} className="group">
                <BookCover book={book} size="lg" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs md:text-sm text-text-muted group-hover:text-text transition">{book.readTime}</p>
                  <AiStatusPills ai={ai} totalChapters={book.chapters} compact />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!search && !genre && !tag && queuedOnDesktop.length > 0 && (
        <section className="px-4 md:px-6 pb-10 md:pb-12 max-w-6xl mx-auto">
          <div className="flex items-end justify-between gap-3 mb-4 md:mb-6">
            <div>
              <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider">Queued On This Desktop</h2>
              <p className="mt-1 text-sm text-text-muted">Books your browser can keep generating in the background.</p>
            </div>
            <Link to="/library" className="hidden md:inline text-sm text-accent hover:underline">Manage Queue</Link>
          </div>
          <div className="grid gap-3 md:gap-4">
            {queuedOnDesktop.map(({ book, ai }) => (
              <BookListItem key={`queued-${book.id}`} book={book} ai={ai} />
            ))}
          </div>
        </section>
      )}

      {!search && !genre && !tag && (
        <section className="px-4 md:px-6 pb-10 md:pb-12 max-w-6xl mx-auto">
          <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4 md:mb-6">Featured</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {featured.map(({ book, ai }) => (
              <Link key={book.id} to={`/read/${book.id}`} className="group">
                <BookCover book={book} size="lg" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs md:text-sm text-text-muted group-hover:text-text transition">{book.readTime}</p>
                  <AiStatusPills ai={ai} totalChapters={book.chapters} compact />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="px-4 md:px-6 pb-20 max-w-6xl mx-auto">
        <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4 md:mb-6">
          {search || genre || tag ? `${filtered.length} results` : 'All Books'}
        </h2>
        <div className="grid gap-3 md:gap-4">
          {filtered.map(({ book, ai }) => (
            <BookListItem key={book.id} book={book} ai={ai} />
          ))}
          {filtered.length === 0 && (
            <p className="text-text-muted py-12 text-center">No books match your search.</p>
          )}
        </div>
      </section>

      <footer className="pt-4 pb-8 text-center">
        <a href="https://freeappstore.online" target="_blank" rel="noopener" className="text-[11px] font-medium text-text-dim hover:text-text transition-colors">
          Part of FreeAppStore — free forever
        </a>
      </footer>
    </div>
  )
}

function BookListItem({ book, ai }: { book: CatalogBook; ai: AiBookState }) {
  const pct = getProgressPercent(book.id)

  return (
    <Link
      to={`/read/${book.id}`}
      className="group flex gap-3 md:gap-5 bg-surface border border-border rounded-lg p-3 md:p-4 hover:border-accent transition"
    >
      <BookCover book={book} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base md:text-lg group-hover:text-accent transition">{book.title}</h3>
            <p className="text-xs md:text-sm text-text-muted mt-0.5">{book.author} &middot; {formatYear(book.year)} &middot; {book.genre}</p>
          </div>
          <AiStatusPills ai={ai} totalChapters={book.chapters} />
        </div>

        <p className="text-xs md:text-sm text-text-dim mt-1.5 md:mt-2 line-clamp-2 hidden sm:block">{book.description}</p>

        <div className="flex gap-1.5 md:gap-2 mt-2 md:mt-3 flex-wrap items-center">
          {book.tags.slice(0, 3).map(t => (
            <span key={t} className="text-[11px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full border border-border text-text-dim">{t}</span>
          ))}
          <span className="text-[11px] md:text-xs text-text-dim ml-auto flex items-center gap-2">
            {pct > 0 && pct < 100 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-12 h-1 bg-surface-hover rounded-full overflow-hidden">
                  <span className="block h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-accent">{pct}%</span>
              </span>
            )}
            {pct === 100 && <span className="text-accent">Done</span>}
            {book.readTime}
          </span>
        </div>
      </div>
    </Link>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-page px-4 py-3">
      <div className="text-lg font-semibold text-text">{value}</div>
      <div className="mt-1 text-xs text-text-dim">{label}</div>
    </div>
  )
}

function AiStatusPills({
  ai,
  totalChapters,
  compact = false,
}: {
  ai: AiBookState
  totalChapters: number
  compact?: boolean
}) {
  const generatedCount = Math.max(ai.generatedCount, ai.readyCount)

  return (
    <div className={`flex ${compact ? 'flex-col items-end gap-1' : 'flex-wrap justify-end gap-1.5'} shrink-0`}>
      {ai.readyCount >= totalChapters && totalChapters > 0 && (
        <span className="rounded-full bg-success/15 px-2 py-1 text-[11px] font-semibold text-success">
          ✦ AI ready
        </span>
      )}
      {ai.readyCount > 0 && ai.readyCount < totalChapters && (
        <span className="rounded-full bg-accent/15 px-2 py-1 text-[11px] font-semibold text-accent">
          ✦ {ai.readyCount}/{totalChapters} ready
        </span>
      )}
      {ai.inLibrary && ai.readyCount < totalChapters && (
        <span className="rounded-full border border-border px-2 py-1 text-[11px] text-text-muted">
          Queue {generatedCount}/{totalChapters}
        </span>
      )}
    </div>
  )
}

function getAiBookState(libraryEntry: LibraryBook | undefined): AiBookState {
  const readyCount = libraryEntry?.generatedChapters || 0

  return {
    inLibrary: Boolean(libraryEntry),
    generatedCount: readyCount,
    readyCount,
  }
}

function formatYear(year: number): string {
  return year > 0 ? String(year) : `${Math.abs(year)} BC`
}
