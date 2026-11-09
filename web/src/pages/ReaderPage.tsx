import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { NavBar } from '../components/NavBar'
import { LibraryButton } from '../components/LibraryButton'
import { SmartPlayButtons } from '../components/SmartPlayButtons'
import { SaveOfflineButton } from '../components/SaveOfflineButton'
import { fetchSavedOr } from '../hooks/offlineBooks'
import { ChapterText } from '../components/ChapterText'
import { getReaderFontSize } from '../hooks/usePreferences'
import { saveProgress, getProgress } from '../hooks/useReadingProgress'
import { getTheme, setTheme, THEME_STYLES, type Theme } from '../hooks/useTheme'
import { CATALOG } from '../data/catalog'
import { getLibrary, LIBRARY_CHANGED_EVENT } from '../hooks/useLibrary'
import { useKokoroReady } from '../hooks/useKokoro'
import { isNarrated, preparedCount, usePreparedManifest } from '../hooks/preparedAudio'

interface ReaderChapter {
  id: string
  title: string
  content: string
}

export function ReaderPage() {
  const { slug } = useParams<{ slug: string }>()
  const [bookTitle, setBookTitle] = useState('')
  const [bookGenre, setBookGenre] = useState('')
  const [bookAuthor, setBookAuthor] = useState('')
  const [chapters, setChapters] = useState<ReaderChapter[]>([])
  const [activeChapter, setActiveChapter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notSavedOffline, setNotSavedOffline] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [fontSize] = useState(getReaderFontSize)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const themeStyle = THEME_STYLES[theme]

  const player = useAudioPlayer()
  const articleRef = useRef<HTMLElement>(null)
  // Saved scroll fraction to restore once the chapter has rendered
  const pendingScrollRef = useRef(0)

  useEffect(() => {
    if (!slug) return
    loadBook(slug)
  }, [slug])

  useEffect(() => {
    function handleLibraryChanged() {
      setLibraryVersion(version => version + 1)
    }

    window.addEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
  }, [])

  // Save reading progress: chapter, plus how far down it the reader has scrolled
  useEffect(() => {
    if (!slug || !activeChapter || chapters.length === 0) return
    const idx = chapters.findIndex(c => c.id === activeChapter)
    if (idx < 0) return
    const scrollFraction = () => {
      const el = articleRef.current
      if (!el) return 0
      const top = el.getBoundingClientRect().top + window.scrollY
      return Math.min(1, Math.max(0, (window.scrollY - top) / el.offsetHeight))
    }
    // Restore the saved position once, on the chapter it was saved for
    const article = articleRef.current
    if (pendingScrollRef.current > 0 && article) {
      const top = article.getBoundingClientRect().top + window.scrollY
      window.scrollTo(0, top + pendingScrollRef.current * article.offsetHeight)
      pendingScrollRef.current = 0
    }
    saveProgress(slug, idx, chapters.length, scrollFraction())
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(() => saveProgress(slug, idx, chapters.length, scrollFraction()), 300)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [slug, activeChapter, chapters.length, loading])

  // Follow the player when its chapter changes (next/prev/auto-advance). Not on
  // activeChapter changes, so the reader can browse other chapters while it plays.
  useEffect(() => {
    if (!slug || chapters.length === 0) return
    if (player.book?.slug !== slug) return
    const target = chapters[player.chapterIdx]
    if (!target) return
    setActiveChapter(prev => {
      if (prev === target.id) return prev
      window.scrollTo(0, 0)
      return target.id
    })
  }, [player.book?.slug, player.chapterIdx, slug, chapters])

  async function loadBook(bookSlug: string) {
    await loadFromCatalog(bookSlug)
    setLoading(false)
  }

  async function loadFromCatalog(bookSlug: string) {
    const catalogBook = CATALOG.find(b => b.id === bookSlug)
    if (!catalogBook) return

    setBookTitle(catalogBook.title)
    setBookGenre(catalogBook.genre)
    setBookAuthor(catalogBook.author)

    try {
      // A book saved for offline opens from this device (books#7)
      const res = await fetchSavedOr(catalogBook.contentPath)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json() as { chapters: { title: string; content: string }[] }
      const chaptersList = data.chapters.map((ch, i) => ({
        id: `ch-${i}`,
        title: ch.title,
        content: ch.content,
      }))
      setChapters(chaptersList)
      const saved = getProgress(bookSlug)
      const startIdx = saved && saved.chapterIdx < chaptersList.length ? saved.chapterIdx : 0
      pendingScrollRef.current = saved?.chapterIdx === startIdx ? saved.scroll ?? 0 : 0
      if (chaptersList.length > 0) setActiveChapter(chaptersList[startIdx].id)
    } catch {
      setNotSavedOffline(!navigator.onLine)
      setChapters([{ id: 'excerpt', title: 'Excerpt', content: catalogBook.excerpt }])
      setActiveChapter('excerpt')
    }
  }

  const isThisBookPlaying = player.book?.slug === slug
  const playingChapterIdx = isThisBookPlaying ? player.chapterIdx : -1

  const currentChapter = chapters.find(c => c.id === activeChapter)
  const visibleChapterIdx = chapters.findIndex(c => c.id === activeChapter)
  const libraryEntry = useMemo(
    () => slug ? getLibrary().find(entry => entry.slug === slug) : undefined,
    [slug, libraryVersion],
  )
  const bookInLibrary = Boolean(libraryEntry)
  const manifest = usePreparedManifest()
  // Only narrated books can be listened to; false while the manifest loads (books#19)
  const narrated = Boolean(slug && manifest && isNarrated(manifest, slug))
  const preparedChapters = narrated ? preparedCount(manifest!, slug!, player.kokoroVoice) : 0
  const fullyPrepared = chapters.length > 0 && preparedChapters >= chapters.length
  const readyCount = Math.max(preparedChapters, libraryEntry?.generatedChapters ?? 0)
  const kokoroReady = useKokoroReady()

  const handleTextClick = useCallback((e: React.MouseEvent) => {
    if (!slug || !currentChapter || !narrated) return
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return

    const container = e.currentTarget as HTMLElement
    // caretPositionFromPoint is the standard (Firefox has only this one); WebKit has caretRangeFromPoint
    const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY)
    const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY)
    const caretNode = pos?.offsetNode ?? range?.startContainer
    const caretOffset = pos?.offset ?? range?.startOffset ?? 0
    if (!caretNode) return

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let offset = 0
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (node === caretNode) {
        offset += caretOffset
        break
      }
      offset += (node.textContent?.length ?? 0)
    }

    // AI narration playing this chapter jumps to the clicked word when it has timings
    if (player.engine === 'kokoro' && player.playing && playingChapterIdx === visibleChapterIdx
      && player.seekToChar(visibleChapterIdx, offset)) return
    // Otherwise listening from a clicked word needs the device voice: AI narration can't start mid-text
    if (player.engine !== 'browser') player.setEngine('browser')
    player.loadAndPlay({ slug, title: bookTitle, author: bookAuthor, chapters }, visibleChapterIdx, offset)
  }, [slug, currentChapter, narrated, player, bookTitle, bookAuthor, chapters, visibleChapterIdx, playingChapterIdx])

  if (loading) {
    return <div className="min-h-dvh bg-page text-text flex items-center justify-center">Loading...</div>
  }

  if (!bookTitle) {
    return (
      <div className="min-h-dvh bg-page text-text flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-xl text-text-muted">Book not found</p>
          <Link to="/" className="text-accent hover:underline">Browse books</Link>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-dvh bg-page text-text ${player.book ? 'pb-20' : ''}`}>
      <NavBar
        title={bookTitle}
        subtitle={bookAuthor ? `${bookAuthor} · ${bookGenre}` : bookGenre}
        actions={<>
          {narrated && <LibraryButton slug={slug || ''} title={bookTitle} totalChapters={chapters.length} />}
          <SaveOfflineButton slug={slug || ''} />
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden px-2.5 py-1.5 rounded-lg text-xs text-text-muted border border-border"
          >
            Ch {visibleChapterIdx + 1}/{chapters.length}
          </button>
          <select
            value={theme}
            onChange={e => { const t = e.target.value as Theme; setThemeState(t); setTheme(t) }}
            className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-text-muted hidden sm:block"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="sepia">Sepia</option>
          </select>
          <SmartPlayButtons
            slug={slug || ''}
            bookTitle={bookTitle}
            bookAuthor={bookAuthor}
            chapters={chapters}
            activeChapterIdx={visibleChapterIdx}
          />
        </>}
      />

      {narrated && chapters.length > 0 && (
        <section className="border-b border-border bg-surface/70">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {fullyPrepared
                  ? 'AI narration is ready for this book'
                  : readyCount >= chapters.length
                  ? 'AI voice is fully ready for this book'
                  : readyCount > 0
                    ? `${readyCount}/${chapters.length} chapters have AI voice on this device`
                    : 'No AI chapters on this device yet'}
              </div>
              <p className="mt-1 text-xs text-text-dim max-w-2xl">
                {fullyPrepared
                  ? 'Press ✦ AI to listen on any device.'
                  : readyCount >= chapters.length
                  ? 'Chapters play instantly from this device, even offline.'
                  : 'Add the book to your Library and this desktop generates the AI voice in the background.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {readyCount > 0 && (
                <span className="rounded-full bg-success/15 px-2.5 py-1 font-semibold text-success">
                  ✦ {readyCount}/{chapters.length} ready
                </span>
              )}
              {bookInLibrary && readyCount < chapters.length && (
                <span className="rounded-full border border-border px-2.5 py-1 text-text-muted">
                  Queued in your desktop library
                </span>
              )}
              {!kokoroReady && readyCount < chapters.length && (
                <Link to="/settings" className="rounded-full border border-border px-2.5 py-1 text-accent hover:border-accent hover:text-text transition">
                  Download AI model
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {notSavedOffline && (
        <div className="border-b border-border bg-warning/10 px-4 py-3 text-center text-sm text-warning">
          You're offline and this book isn't saved on this device. Only the excerpt is available.
        </div>
      )}

      {/* Mobile chapter drawer */}
      {sidebarOpen && (
        <div className="md:hidden border-b border-border bg-surface px-4 py-3 max-h-60 overflow-y-auto">
          <div className="space-y-1">
            {chapters.map((ch, i) => (
              <button
                key={ch.id}
                onClick={() => { setActiveChapter(ch.id); setSidebarOpen(false); window.scrollTo(0, 0) }}
                className={`w-full text-left px-3 py-2.5 rounded text-sm transition flex items-center gap-2 ${
                  activeChapter === ch.id ? 'bg-surface-hover text-text' : 'text-text-muted'
                }`}
              >
                {isThisBookPlaying && playingChapterIdx === i && player.playing && (
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                )}
                <span className="truncate">{ch.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 md:grid md:grid-cols-[220px_1fr] md:gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden md:block">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Chapters</h2>
          <div className="space-y-1 sticky top-6 max-h-[calc(100dvh-4rem)] overflow-y-auto">
            {chapters.map((ch, i) => (
              <button
                key={ch.id}
                onClick={() => { setActiveChapter(ch.id); window.scrollTo(0, 0) }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2 ${
                  activeChapter === ch.id ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text hover:bg-surface'
                }`}
              >
                {isThisBookPlaying && playingChapterIdx === i && player.playing && (
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                )}
                <span className="truncate">{ch.title}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Content */}
        <main className={`${themeStyle.bg} ${themeStyle.text} rounded-xl p-4 md:p-8 transition-colors`}>
          {currentChapter ? (
            <article ref={articleRef}>
              <h2 className="font-display mb-4 md:mb-6" style={{ fontSize: `${Math.round(fontSize * 1.35)}px` }}>{currentChapter.title}</h2>
              <ChapterText
                content={currentChapter.content}
                chapterIdx={visibleChapterIdx}
                active={isThisBookPlaying && player.playing}
                className={`${themeStyle.muted} whitespace-pre-wrap ${narrated ? 'cursor-pointer' : ''}`}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
                onClick={handleTextClick}
                title={narrated ? 'Click to start listening from here' : undefined}
              />

              <div className="flex justify-between mt-8 md:mt-12 pt-4 md:pt-6 border-t border-border">
                {(() => {
                  const idx = chapters.findIndex(c => c.id === activeChapter)
                  return (
                    <>
                      {idx > 0 ? (
                        <button
                          onClick={() => { setActiveChapter(chapters[idx - 1].id); window.scrollTo(0, 0) }}
                          className="text-text-muted hover:text-text transition text-sm max-w-[45%] truncate"
                        >
                          &larr; {chapters[idx - 1].title}
                        </button>
                      ) : <span />}
                      {idx < chapters.length - 1 ? (
                        <button
                          onClick={() => { setActiveChapter(chapters[idx + 1].id); window.scrollTo(0, 0) }}
                          className="text-text-muted hover:text-text transition text-sm max-w-[45%] truncate text-right"
                        >
                          {chapters[idx + 1].title} &rarr;
                        </button>
                      ) : <span />}
                    </>
                  )
                })()}
              </div>
            </article>
          ) : (
            <p className="text-text-muted">Select a chapter to start reading.</p>
          )}
        </main>
      </div>
    </div>
  )
}
