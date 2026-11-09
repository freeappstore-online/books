import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { NavBar } from '../components/NavBar'
import { PlayButton } from '../components/PlayButton'
import { SaveOfflineButton, SaveOfflineError } from '../components/SaveOfflineButton'
import { fetchSavedOr, playableManifest, useOnline } from '../hooks/offlineBooks'
import { ChapterText, textOffset, topInset, type TextMark } from '../components/ChapterText'
import { BookSearch, SEARCH_INPUT_ID } from '../components/BookSearch'
import type { SearchHit } from '../hooks/bookSearch'
import { AnnotationEditor, AnnotationList, BookmarkIcon, HighlightToolbar } from '../components/Annotations'
import {
  HIGHLIGHT_COLORS, addAnnotation, annotationsMarkdown, downloadMarkdown, useAllAnnotations,
  type Annotation, type HighlightColor,
} from '../hooks/annotations'
import { sentenceRanges } from '../hooks/readAlong'
import { getNarrationTime } from '../hooks/narration'
import { useReaderFontSize } from '../hooks/usePreferences'
import { TextSizeControls } from '../components/TextSizeControls'
import { saveProgress, getProgress, setFinished, useFinished } from '../hooks/useReadingProgress'
import { TimeLeft } from '../components/TimeLeft'
import { getTheme, setTheme, THEME_STYLES, type Theme } from '../hooks/useTheme'
import { CATALOG } from '../data/catalog'
import { isNarrated, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'

/** Chapter offset of the first text on screen, for a bookmark of the reading position. */
function firstVisibleOffset(container: HTMLElement): number {
  const rect = container.getBoundingClientRect()
  const inset = topInset()
  if (rect.top >= inset) return 0
  const x = rect.left + 1
  const y = Math.min(inset + 16, rect.bottom - 1)
  const pos = document.caretPositionFromPoint?.(x, y)
  const range = pos ? null : document.caretRangeFromPoint?.(x, y)
  const node = pos?.offsetNode ?? range?.startContainer
  return node && container.contains(node) ? textOffset(container, node, pos?.offset ?? range?.startOffset ?? 0) : 0
}

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
  const [moreOpen, setMoreOpen] = useState(false)
  const textButtonRef = useRef<HTMLButtonElement>(null)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const themeStyle = THEME_STYLES[theme]
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHit, setSearchHit] = useState<SearchHit | null>(null)
  // Chapter offset to scroll to once the chapter shows (search, bookmarks)
  const [focus, setFocus] = useState<{ offset: number } | null>(null)
  // How far down the chapter on screen the reader is, 0–1 (for the time left)
  const [chapterScroll, setChapterScroll] = useState(0)
  const finished = useFinished()
  const [notesOpen, setNotesOpen] = useState(false)
  // Text selected in the chapter, offered for highlighting
  const [selection, setSelection] = useState<{ start: number; end: number; rect: DOMRect } | null>(null)
  const [editing, setEditing] = useState<Annotation | null>(null)
  const allAnnotations = useAllAnnotations()
  const annotations = useMemo(() => (slug && allAnnotations[slug]) || [], [allAnnotations, slug])

  const player = useAudioPlayer()
  const articleRef = useRef<HTMLElement>(null)
  // Saved scroll fraction to restore once the chapter has rendered
  const pendingScrollRef = useRef(0)

  useEffect(() => {
    if (!slug) return
    loadBook(slug)
  }, [slug])

  // Where each chapter starts in the whole text, and the total, for the share of the book read
  const chapterStarts = useMemo(() => {
    const starts = [0]
    for (const c of chapters) starts.push(starts[starts.length - 1] + c.content.length)
    return starts
  }, [chapters])

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
    const save = () => {
      const scroll = scrollFraction()
      const total = chapterStarts[chapterStarts.length - 1]
      const fraction = total > 0 ? (chapterStarts[idx] + scroll * chapters[idx].content.length) / total : 0
      saveProgress(slug, idx, chapters.length, scroll, fraction)
      setChapterScroll(scroll)
    }
    // Restore the saved position once, on the chapter it was saved for
    const article = articleRef.current
    if (pendingScrollRef.current > 0 && article) {
      const top = article.getBoundingClientRect().top + window.scrollY
      window.scrollTo(0, top + pendingScrollRef.current * article.offsetHeight)
      pendingScrollRef.current = 0
    }
    save()
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(save, 300)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [slug, activeChapter, chapters, chapterStarts, loading])

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

  // Escape closes the text size panel and returns focus to its button (books#15)
  useEffect(() => {
    if (!textPanelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setTextPanelOpen(false)
      textButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [textPanelOpen])

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
      // A bookmark or highlight opened from My books: /read/<slug>?ch=<idx>&at=<offset>
      const params = new URLSearchParams(window.location.search)
      const linkedIdx = params.has('ch') ? Number(params.get('ch')) : NaN
      if (linkedIdx >= 0 && linkedIdx < chaptersList.length) {
        setActiveChapter(chaptersList[linkedIdx].id)
        setFocus({ offset: Number(params.get('at')) || 0 })
        return
      }
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
  const online = useOnline()
  // Only narrated books can be listened to; false while the manifest loads (books#19).
  // Offline, only if saved on this device (books#24).
  const narrated = Boolean(slug && manifest && isNarrated(playableManifest(manifest, online), slug))
  const listenOffline = Boolean(slug && manifest && !online && !narrated && isNarrated(manifest, slug))

  const handleTextClick = useCallback((e: React.MouseEvent) => {
    if (!slug || !currentChapter) return
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    // A click on a highlight opens it
    const mark = (e.target as Element).closest?.('[data-mark^="hl-"]')
    const highlight = mark && annotations.find(a => a.id === mark.getAttribute('data-mark'))
    if (highlight) {
      setEditing(highlight)
      return
    }
    if (!narrated) return

    const container = e.currentTarget as HTMLElement
    // caretPositionFromPoint is the standard (Firefox has only this one); WebKit has caretRangeFromPoint
    const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY)
    const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY)
    const caretNode = pos?.offsetNode ?? range?.startContainer
    const caretOffset = pos?.offset ?? range?.startOffset ?? 0
    if (!caretNode || !container.contains(caretNode)) return

    // Listen from the clicked word (seeks there when this chapter is playing)
    player.loadAndPlay({ slug, title: bookTitle, author: bookAuthor, chapters }, visibleChapterIdx, textOffset(container, caretNode, caretOffset))
  }, [slug, currentChapter, narrated, player, bookTitle, bookAuthor, chapters, visibleChapterIdx, annotations])

  /** Show chapter `chapterIdx` scrolled to char `offset`. */
  const jumpTo = useCallback((chapterIdx: number, offset: number) => {
    const target = chapters[chapterIdx]
    if (!target) return
    setActiveChapter(target.id)
    setSidebarOpen(false)
    setFocus({ offset })
  }, [chapters])

  const onSearchJump = useCallback((hit: SearchHit) => {
    setSearchHit(hit)
    jumpTo(hit.chapterIdx, hit.start)
  }, [jumpTo])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchHit(null)
  }, [])

  // "/" opens the search, as on many sites
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // KeyboardShortcuts focuses the field while it is open; this opens it
      if (e.key !== '/' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      setSearchOpen(true)
      document.getElementById(SEARCH_INPUT_ID)?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const marks = useMemo<TextMark[]>(() => {
    const list: TextMark[] = annotations
      .filter(a => a.kind === 'highlight' && a.chapterIdx === visibleChapterIdx)
      .map(a => ({
        start: a.start,
        end: a.end,
        id: a.id,
        className: `${HIGHLIGHT_COLORS[a.color ?? 'yellow'].className} cursor-pointer ${a.note ? 'underline decoration-dotted underline-offset-4' : ''}`,
      }))
    if (searchHit && searchHit.chapterIdx === visibleChapterIdx) {
      list.push({ start: searchHit.start, end: searchHit.end, id: 'search', className: 'bg-warning/40 outline-2 outline-warning rounded-sm' })
    }
    return list
  }, [annotations, searchHit, visibleChapterIdx])

  // Selecting text in the chapter offers to highlight it
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = window.getSelection()
        const container = articleRef.current?.querySelector<HTMLElement>('[data-chapter-text]')
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container) { setSelection(null); return }
        const range = sel.getRangeAt(0)
        if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) { setSelection(null); return }
        const start = textOffset(container, range.startContainer, range.startOffset)
        const end = textOffset(container, range.endContainer, range.endOffset)
        setSelection(end > start ? { start, end, rect: range.getBoundingClientRect() } : null)
      }, 150)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [])

  const addHighlight = (color: HighlightColor, withNote: boolean) => {
    if (!slug || !selection || !currentChapter) return
    const text = currentChapter.content.slice(selection.start, selection.end).trim()
    const a = addAnnotation(slug, { kind: 'highlight', chapterIdx: visibleChapterIdx, start: selection.start, end: selection.end, color, text })
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    if (withNote) setEditing(a)
  }

  /** Bookmark the listening position while this book plays, else the reading position. */
  const addBookmark = () => {
    if (!slug || chapters.length === 0) return
    const spoken = isThisBookPlaying && player.playing ? player.getReadAlong() : null
    let chapterIdx = visibleChapterIdx
    let offset = 0
    let seconds: number | undefined
    if (spoken) {
      chapterIdx = spoken.chapterIdx
      offset = (spoken.word ?? spoken.sentence)?.[0] ?? 0
      seconds = Math.round(getNarrationTime(preparedUrl(slug, chapterIdx)))
    } else {
      const container = articleRef.current?.querySelector<HTMLElement>('[data-chapter-text]')
      if (container) offset = firstVisibleOffset(container)
    }
    // Named with the sentence at that point
    const text = chapters[chapterIdx].content
    const [a, b] = sentenceRanges(text).find(r => r[1] > offset) ?? [offset, text.length]
    const name = text.slice(a, b).replace(/\s+/g, ' ').trim()
    addAnnotation(slug, { kind: 'bookmark', chapterIdx, start: offset, end: offset, seconds, text: name.length > 160 ? `${name.slice(0, 160)}…` : name })
  }

  const jumpToAnnotation = (a: Annotation) => {
    setNotesOpen(false)
    jumpTo(a.chapterIdx, a.start)
    // Listening: the narration goes there too
    if (slug && isThisBookPlaying && player.playing) {
      player.loadAndPlay({ slug, title: bookTitle, author: bookAuthor, chapters }, a.chapterIdx, a.start)
    }
  }

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
    <div className="min-h-dvh bg-page text-text">
      {/* Stays on screen while reading, so bookmarking, search and the chapter list are always at hand */}
      <div data-reader-top="" className="sticky top-0 z-30 bg-page">
        <NavBar
          title={bookTitle}
          subtitle={bookAuthor ? `${bookAuthor} · ${bookGenre}` : bookGenre}
          actions={<>
            <button
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-expanded={searchOpen}
              aria-label="Search in this book"
              title="Search in this book (/)"
              className={`min-h-10 min-w-10 flex items-center justify-center p-1.5 rounded-lg border border-border transition ${searchOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
            </button>
            <button
              onClick={() => setNotesOpen(o => !o)}
              aria-expanded={notesOpen}
              aria-label="Bookmarks and notes"
              title="Bookmarks and notes"
              className={`min-h-10 min-w-10 flex items-center justify-center p-1.5 rounded-lg border border-border transition ${notesOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
            >
              <BookmarkIcon />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-expanded={sidebarOpen}
              aria-controls="chapter-drawer"
              aria-label={`Chapters: chapter ${visibleChapterIdx + 1} of ${chapters.length}`}
              className="md:hidden min-h-10 px-3 py-1.5 rounded-lg text-xs text-text-muted border border-border"
            >
              Ch {visibleChapterIdx + 1}/{chapters.length}
            </button>
            {/* Phones: Save offline, text size and theme sit behind "More" on a row of their own,
                so search, bookmarks, chapters and Play fit on one line; from sm they're inline */}
            <button
              onClick={() => setMoreOpen(o => !o)}
              aria-expanded={moreOpen}
              aria-controls="reader-more"
              aria-label="More reading options"
              title="More reading options"
              className={`sm:hidden min-h-10 min-w-10 flex items-center justify-center rounded-lg border border-border transition ${moreOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            </button>
            <div id="reader-more" className={`${moreOpen ? 'flex' : 'hidden'} sm:contents order-last basis-full items-center justify-end gap-2`}>
              <SaveOfflineButton slug={slug || ''} />
              {/* Not positioned: the panel hangs from the header's right edge, on screen on phones too */}
              <div>
                <button
                  ref={textButtonRef}
                  onClick={() => setTextPanelOpen(o => !o)}
                  aria-expanded={textPanelOpen}
                  aria-controls="text-size-panel"
                  aria-label="Text size"
                  title="Text size"
                  className={`min-h-10 px-2.5 py-1.5 rounded-lg text-sm border border-border transition ${textPanelOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
                >
                  <span aria-hidden="true"><span className="text-xs">A</span><span className="text-base font-semibold">A</span></span>
                </button>
                {textPanelOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setTextPanelOpen(false)} />
                    <div id="text-size-panel" role="group" aria-label="Text size" className="absolute right-4 md:right-6 top-full mt-1 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-xl text-left">
                      <TextSizeControls preview={false} />
                    </div>
                  </>
                )}
              </div>
              <select
                value={theme}
                onChange={e => { const t = e.target.value as Theme; setThemeState(t); setTheme(t) }}
                aria-label="Theme"
                className="min-h-10 bg-surface border border-border rounded-lg px-2 py-1.5 text-base sm:text-xs text-text-muted"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="sepia">Sepia</option>
              </select>
            </div>
            <PlayButton
              slug={slug || ''}
              bookTitle={bookTitle}
              bookAuthor={bookAuthor}
              chapters={chapters}
              activeChapterIdx={visibleChapterIdx}
            />
          </>}
        />

        {searchOpen && <BookSearch chapters={chapters} onJump={onSearchJump} onClose={closeSearch} />}

        {notesOpen && slug && (
          <section aria-label="Bookmarks and notes" className="border-b border-border bg-surface">
            <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={addBookmark}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent hover:bg-accent-hover text-btn-text transition"
                >
                  <BookmarkIcon size={14} /> Bookmark this place
                </button>
                {annotations.length > 0 && (
                  <button
                    onClick={() => downloadMarkdown(`${slug}-notes.md`, annotationsMarkdown(bookTitle, bookAuthor, chapters.map(c => c.title), annotations))}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border text-text-muted hover:text-text transition"
                  >
                    Export Markdown
                  </button>
                )}
                <button onClick={() => setNotesOpen(false)} aria-label="Close bookmarks and notes" className="ml-auto px-2.5 py-1.5 rounded-lg text-sm border border-border text-text-muted hover:text-text transition">&times;</button>
              </div>
              {annotations.length === 0 ? (
                <p className="mt-3 text-sm text-text-muted">
                  Bookmarks keep your place (while listening, the spoken sentence). Select text to highlight it or add a note.
                </p>
              ) : (
                <div className="mt-2 max-h-[min(24rem,55dvh)] overflow-y-auto">
                  <AnnotationList slug={slug} list={annotations} chapterTitles={chapters.map(c => c.title)} onJump={jumpToAnnotation} />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Mobile chapter drawer */}
        {sidebarOpen && (
          <nav id="chapter-drawer" aria-label="Chapters" className="md:hidden border-b border-border bg-surface px-4 py-3 max-h-60 overflow-y-auto">
            <div className="space-y-1">
              {chapters.map((ch, i) => (
                <button
                  key={ch.id}
                  onClick={() => { setActiveChapter(ch.id); setSidebarOpen(false); window.scrollTo(0, 0) }}
                  aria-current={activeChapter === ch.id ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2.5 rounded text-sm transition flex items-center gap-2 ${
                    activeChapter === ch.id ? 'bg-surface-hover text-text' : 'text-text-muted'
                  }`}
                >
                  {isThisBookPlaying && playingChapterIdx === i && player.playing && (
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" role="img" aria-label="Playing" />
                  )}
                  <span className="truncate">{ch.title}</span>
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>

      {selection && <HighlightToolbar rect={selection.rect} onHighlight={addHighlight} />}
      {editing && slug && <AnnotationEditor slug={slug} annotation={editing} onClose={() => setEditing(null)} />}

      <SaveOfflineError slug={slug || ''} />
      {notSavedOffline && (
        <div className="border-b border-border bg-warning/10 px-4 py-3 text-center text-sm text-warning">
          You're offline and this book isn't saved on this device. Only the excerpt is available.
        </div>
      )}
      {!notSavedOffline && listenOffline && (
        <div role="status" className="border-b border-border bg-warning/10 px-4 py-3 text-center text-sm text-warning">
          You're offline. Listening needs a connection unless the book is saved on this device.
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 md:grid md:grid-cols-[220px_1fr] md:gap-8">
        {/* Desktop sidebar */}
        <aside aria-labelledby="chapters-heading" className="hidden md:block">
          <h2 id="chapters-heading" className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Chapters</h2>
          <div className="space-y-1 sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto">
            {chapters.map((ch, i) => (
              <button
                key={ch.id}
                onClick={() => { setActiveChapter(ch.id); window.scrollTo(0, 0) }}
                aria-current={activeChapter === ch.id ? 'true' : undefined}
                className={`w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2 ${
                  activeChapter === ch.id ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text hover:bg-surface'
                }`}
              >
                {isThisBookPlaying && playingChapterIdx === i && player.playing && (
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" role="img" aria-label="Playing" />
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
              <h2 className="font-display mb-1" style={{ fontSize: `${Math.round(fontSize * 1.35)}px` }}>{currentChapter.title}</h2>
              <TimeLeft slug={slug || ''} chapters={chapters} chapterIdx={visibleChapterIdx} scroll={chapterScroll} />
              <ChapterText
                content={currentChapter.content}
                chapterIdx={visibleChapterIdx}
                active={isThisBookPlaying && player.playing}
                className={`${themeStyle.muted} whitespace-pre-wrap ${narrated ? 'cursor-pointer' : ''}`}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
                onClick={handleTextClick}
                title={narrated ? 'Click to start listening from here' : undefined}
                marks={marks}
                focus={focus}
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
                      ) : slug && chapters.length > 1 ? (
                        <button
                          onClick={() => setFinished(slug, !finished[slug])}
                          aria-pressed={Boolean(finished[slug])}
                          className={`text-sm font-semibold transition ${finished[slug] ? 'text-success' : 'text-accent hover:text-accent-hover'}`}
                        >
                          {finished[slug] ? '✓ Finished' : 'Mark as finished'}
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
