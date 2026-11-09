import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CATALOG, GENRES, ALL_TAGS, type CatalogBook } from '../data/catalog'
import { BookCover } from '../components/BookCover'
import { NavBar } from '../components/NavBar'
import { booksInProgress, progressPercent, useFinished, type BookProgress } from '../hooks/useReadingProgress'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { ListenButton } from '../components/ListenButton'
import { isNarrated, usePreparedManifest } from '../hooks/preparedAudio'
import { useOfflineBooks, useOnline, usePlayableManifest } from '../hooks/offlineBooks'

export function CatalogPage() {
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string>('')
  const [tag, setTag] = useState<string>('')
  const [sort, setSort] = useState<'title' | 'author' | 'year'>('title')
  // Offline, only saved books can be listened to (books#24)
  const manifest = usePlayableManifest()
  const { saved } = useOfflineBooks()
  const online = useOnline()
  // Offline, only books saved on this device can be opened (books#7)
  const dim = (id: string) => (!online && !saved[id] ? 'opacity-40' : '')

  // Books with narration can be listened to; none show as such while the manifest loads (books#19)
  const entries = useMemo(
    () => CATALOG.map(book => ({ book, narrated: Boolean(manifest && isNarrated(manifest, book.id)) })),
    [manifest],
  )

  const filtered = useMemo(() => {
    let books = [...entries]

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
  }, [entries, search, genre, tag, sort])

  const player = useAudioPlayer()
  const finished = useFinished()
  // Listened shares need every narrated book's lengths, playable now or not
  const fullManifest = usePreparedManifest()
  const progress = useMemo(
    () => new Map(booksInProgress(player.history, fullManifest, finished).map(p => [p.slug, p])),
    [player.history, fullManifest, finished],
  )

  const featured = entries.slice(0, 4)
  const audiobooks = entries.filter(e => e.narrated).slice(0, 4)

  return (
    <div className="min-h-dvh bg-page text-text">
      <NavBar />

      <main>
      <ContinueShelf entries={entries} dim={dim} />

      <section className="px-4 md:px-6 py-10 md:py-16 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-display leading-tight mb-3 md:mb-4">
            Discover Books,<br />
            <span className="text-accent italic">Read or Listen</span>
          </h1>
          <p className="text-base md:text-xl text-text-muted max-w-2xl mb-6 md:mb-8">
            Read any book in the catalog for free. Books marked Audiobook can also be listened to, with the text following along.
          </p>

          <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search books, authors, genres, topics..."
              aria-label="Search books"
              aria-keyshortcuts="/"
              data-shortcut="search"
              className="w-full md:flex-1 md:min-w-64 bg-surface border border-border rounded-lg px-4 py-3 text-text placeholder-text-dim focus:border-accent transition"
            />
            <div className="flex gap-2">
              <select
                value={genre}
                onChange={e => setGenre(e.target.value)}
                aria-label="Genre"
                className="flex-1 md:flex-none bg-surface border border-border rounded-lg px-3 py-3 text-text text-base md:text-sm"
              >
                <option value="">All Genres</option>
                {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as 'title' | 'author' | 'year')}
                aria-label="Sort"
                className="flex-1 md:flex-none bg-surface border border-border rounded-lg px-3 py-3 text-text text-base md:text-sm"
              >
                <option value="title">By Title</option>
                <option value="author">By Author</option>
                <option value="year">By Year</option>
              </select>
            </div>
          </div>

          {/* Phones: one row that scrolls sideways, so 40 px chips don't push the books down */}
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
            {tag && (
              <button
                onClick={() => setTag('')}
                aria-label={`Remove filter: ${tag}`}
                className="shrink-0 min-h-10 md:min-h-0 text-xs px-3 py-1 rounded-full bg-accent text-btn-text font-semibold"
              >
                {tag} &times;
              </button>
            )}
            {ALL_TAGS.filter(t => t !== tag).slice(0, 12).map(t => (
              <button
                key={t}
                onClick={() => setTag(t)}
                className="shrink-0 min-h-10 md:min-h-0 text-xs px-3 py-1 rounded-full border border-border text-text-muted hover:border-accent hover:text-accent transition"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!search && !genre && !tag && audiobooks.length > 0 && (
        <section className="px-4 md:px-6 pb-10 md:pb-12 max-w-6xl mx-auto">
          <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4 md:mb-6">Audiobooks</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {audiobooks.map(({ book }) => (
              <Link key={book.id} to={`/read/${book.id}`} className={`group ${dim(book.id)}`}>
                <BookCover book={book} size="lg" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs md:text-sm text-text-muted group-hover:text-text transition">{book.readTime}</p>
                  <AudiobookPill />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!search && !genre && !tag && (
        <section className="px-4 md:px-6 pb-10 md:pb-12 max-w-6xl mx-auto">
          <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4 md:mb-6">Featured</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {featured.map(({ book, narrated }) => (
              <Link key={book.id} to={`/read/${book.id}`} className={`group ${dim(book.id)}`}>
                <BookCover book={book} size="lg" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs md:text-sm text-text-muted group-hover:text-text transition">{book.readTime}</p>
                  {narrated && <AudiobookPill />}
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
          {filtered.map(({ book, narrated }) => (
            <BookListItem
              key={book.id} book={book} narrated={narrated} saved={Boolean(saved[book.id])} online={online}
              progress={progress.get(book.id)} finished={Boolean(finished[book.id])}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-text-muted py-12 text-center">No books match your search.</p>
          )}
        </div>
      </section>
      </main>

      <footer className="pt-4 pb-8 text-center">
        <a href="https://freeappstore.online" target="_blank" rel="noopener" className="inline-block py-3 text-[11px] font-medium text-text-dim hover:text-text transition-colors">
          Part of FreeAppStore — free forever
        </a>
      </footer>
    </div>
  )
}

function BookListItem({ book, narrated, saved, online, progress, finished }: {
  book: CatalogBook; narrated: boolean; saved: boolean; online: boolean; progress?: BookProgress; finished: boolean
}) {
  const pct = progress ? progressPercent(progress) : 0

  return (
    <Link
      to={`/read/${book.id}`}
      className={`group flex gap-3 md:gap-5 bg-surface border border-border rounded-lg p-3 md:p-4 hover:border-accent transition ${!online && !saved ? 'opacity-40' : ''}`}
    >
      <BookCover book={book} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base md:text-lg group-hover:text-accent transition">{book.title}</h3>
            <p className="text-xs md:text-sm text-text-muted mt-0.5">{book.author} &middot; {formatYear(book.year)} &middot; {book.genre}</p>
          </div>
          {narrated && <AudiobookPill />}
        </div>

        <p className="text-xs md:text-sm text-text-dim mt-1.5 md:mt-2 line-clamp-2 hidden sm:block">{book.description}</p>

        <div className="flex gap-1.5 md:gap-2 mt-2 md:mt-3 flex-wrap items-center">
          {book.tags.slice(0, 3).map(t => (
            <span key={t} className="text-[11px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full border border-border text-text-dim">{t}</span>
          ))}
          <span className="text-[11px] md:text-xs text-text-dim ml-auto flex items-center gap-2">
            {saved && <span className="text-success">✓ Saved offline</span>}
            {!saved && !online && <span>Not saved: unavailable offline</span>}
            {!finished && pct > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-12 h-1 bg-surface-hover rounded-full overflow-hidden">
                  <span className="block h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-accent">{pct}%</span>
              </span>
            )}
            {finished && <span className="text-success">✓ Finished</span>}
            {book.readTime}
          </span>
        </div>
      </div>
    </Link>
  )
}

/** Books in progress, reading or listening, each resuming where it stopped (books#13). */
function ContinueShelf({ entries, dim }: { entries: { book: CatalogBook; narrated: boolean }[]; dim: (id: string) => string }) {
  const player = useAudioPlayer()
  const manifest = usePreparedManifest()
  const finished = useFinished()
  const books = booksInProgress(player.history, manifest, finished)
    .flatMap(p => {
      const entry = entries.find(e => e.book.id === p.slug)
      return entry ? [{ ...entry, progress: p }] : []
    })
    .slice(0, 4)
  if (books.length === 0) return null

  return (
    <section aria-labelledby="continue-heading" className="px-4 md:px-6 pt-6 md:pt-8 max-w-6xl mx-auto">
      <h2 id="continue-heading" className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4">Continue</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {books.map(({ book, narrated, progress }) => {
          const pct = progressPercent(progress)
          return (
            <div key={book.id} className={dim(book.id)}>
              <Link to={`/read/${book.id}`} className="group block" aria-label={`Continue reading ${book.title}`}>
                <BookCover book={book} size="lg" />
              </Link>
              <div className="mt-2 h-1 bg-surface-hover rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs text-text-dim">{pct}% · Ch {progress.chapterIdx + 1}/{book.chapters}</p>
                {narrated && (
                  <ListenButton book={book} className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-btn-text hover:bg-accent-hover transition" />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function AudiobookPill() {
  return (
    <span className="shrink-0 rounded-full bg-success/15 px-2 py-1 text-[11px] font-semibold text-success">
      Audiobook
    </span>
  )
}

function formatYear(year: number): string {
  return year > 0 ? String(year) : `${Math.abs(year)} BC`
}
