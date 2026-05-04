import { useState, useMemo } from 'react'
import { CATALOG, GENRES, type CatalogBook } from '../data/catalog'
import { getRecentBooks } from '../hooks/useProgress'

interface LibraryProps {
  onSelectBook: (book: CatalogBook) => void
}

export default function Library({ onSelectBook }: LibraryProps) {
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState('All')
  const recentBookIds = useMemo(() => getRecentBooks().map(r => r.bookId), [])

  const filtered = useMemo(() => {
    let books = CATALOG
    if (genre !== 'All') {
      books = books.filter(b => b.genre === genre)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      books = books.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.tags.some(t => t.includes(q))
      )
    }
    return books
  }, [search, genre])

  const recentBooks = useMemo(() => {
    if (search || genre !== 'All') return []
    return recentBookIds
      .map(id => CATALOG.find(b => b.id === id))
      .filter((b): b is CatalogBook => !!b)
  }, [recentBookIds, search, genre])

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-warm-50/90 dark:bg-warm-950/90 backdrop-blur-sm border-b border-warm-200 dark:border-warm-800">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold text-warm-800 dark:text-warm-100">
              FreeBooks
            </h1>
            <button
              onClick={() => {
                document.documentElement.classList.toggle('dark')
                const isDark = document.documentElement.classList.contains('dark')
                localStorage.setItem('freebooks-theme', isDark ? 'dark' : 'light')
              }}
              className="p-2 rounded-lg hover:bg-warm-200 dark:hover:bg-warm-800 transition-colors"
              aria-label="Toggle theme"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-warm-800 dark:text-warm-100">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </button>
          </div>

          {/* Search and filter */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search books or authors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-warm-200/50 dark:bg-warm-800/50 border border-warm-200 dark:border-warm-800 text-warm-800 dark:text-warm-100 placeholder:text-warm-800/40 dark:placeholder:text-warm-100/40 outline-none focus:ring-2 focus:ring-warm-800/20 dark:focus:ring-warm-100/20 text-sm"
            />
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="px-3 py-2 rounded-lg bg-warm-200/50 dark:bg-warm-800/50 border border-warm-200 dark:border-warm-800 text-warm-800 dark:text-warm-100 outline-none text-sm cursor-pointer"
            >
              <option value="All">All Genres</option>
              {GENRES.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Continue Reading */}
        {recentBooks.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-warm-800/60 dark:text-warm-100/60 uppercase tracking-wide mb-3">
              Continue Reading
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
              {recentBooks.map(book => (
                <button
                  key={book.id}
                  onClick={() => onSelectBook(book)}
                  className="flex-shrink-0 w-32 text-left group"
                >
                  <div
                    className="w-32 h-44 rounded-lg flex flex-col items-center justify-center p-3 text-center shadow-md group-hover:scale-105 transition-transform"
                    style={{ background: book.coverGradient }}
                  >
                    <span className="text-xs font-bold text-white/90 leading-tight line-clamp-3">
                      {book.title}
                    </span>
                    <span className="text-[10px] text-white/60 mt-1">{book.author}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Book grid */}
        <section>
          <p className="text-sm text-warm-800/50 dark:text-warm-100/50 mb-4">
            {filtered.length} {filtered.length === 1 ? 'book' : 'books'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filtered.map(book => (
              <button
                key={book.id}
                onClick={() => onSelectBook(book)}
                className="text-left group"
              >
                <div
                  className="aspect-[2/3] rounded-lg flex flex-col items-center justify-center p-3 text-center shadow-md group-hover:scale-[1.03] transition-transform"
                  style={{ background: book.coverGradient }}
                >
                  <span
                    className="text-xs font-bold leading-tight line-clamp-3 mb-1"
                    style={{ color: book.coverAccent }}
                  >
                    {book.title}
                  </span>
                  <span className="text-[10px] text-white/60">{book.author}</span>
                </div>
                <div className="mt-2 px-1">
                  <p className="text-xs font-medium text-warm-800 dark:text-warm-100 line-clamp-1">
                    {book.title}
                  </p>
                  <p className="text-[10px] text-warm-800/50 dark:text-warm-100/50">
                    {book.author} &middot; {book.readTime}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <div className="pt-8 pb-4 text-center">
          <a href="https://freeappstore.online" target="_blank" rel="noopener" className="text-[11px] font-medium text-warm-800/40 dark:text-warm-100/40 hover:text-warm-800 dark:hover:text-warm-100 transition-colors">
            Part of FreeAppStore — free forever
          </a>
        </div>
      </main>
    </div>
  )
}
