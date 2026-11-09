import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { NavBar } from '../components/NavBar'
import { PlayButton } from '../components/PlayButton'
import { SaveOfflineButton } from '../components/SaveOfflineButton'
import { fetchSavedOr } from '../hooks/offlineBooks'
import { ChapterText } from '../components/ChapterText'
import { useReaderFontSize } from '../hooks/usePreferences'
import { TextSizeControls } from '../components/TextSizeControls'
import { saveProgress, getProgress } from '../hooks/useReadingProgress'
import { getTheme, setTheme, THEME_STYLES, type Theme } from '../hooks/useTheme'
import { CATALOG } from '../data/catalog'
import { isNarrated, usePreparedManifest } from '../hooks/preparedAudio'

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
  const fontSize = useReaderFontSize()
  const [textPanelOpen, setTextPanelOpen] = useState(false)
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
  const manifest = usePreparedManifest()
  // Only narrated books can be listened to; false while the manifest loads (books#19)
  const narrated = Boolean(slug && manifest && isNarrated(manifest, slug))

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

    // Listen from the clicked word (seeks there when this chapter is playing)
    player.loadAndPlay({ slug, title: bookTitle, author: bookAuthor, chapters }, visibleChapterIdx, offset)
  }, [slug, currentChapter, narrated, player, bookTitle, bookAuthor, chapters, visibleChapterIdx])

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
          <SaveOfflineButton slug={slug || ''} />
          <div className="relative">
            <button
              onClick={() => setTextPanelOpen(o => !o)}
              aria-expanded={textPanelOpen}
              aria-label="Text size"
              title="Text size"
              className={`px-2.5 py-1.5 rounded-lg text-sm border border-border transition ${textPanelOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
            >
              <span className="text-xs">A</span><span className="text-base font-semibold">A</span>
            </button>
            {textPanelOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setTextPanelOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-xl text-left">
                  <TextSizeControls preview={false} />
                </div>
              </>
            )}
          </div>
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
          <PlayButton
            slug={slug || ''}
            bookTitle={bookTitle}
            bookAuthor={bookAuthor}
            chapters={chapters}
            activeChapterIdx={visibleChapterIdx}
          />
        </>}
      />

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
