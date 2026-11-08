import { useState, useEffect, useCallback, useRef } from 'react'
import { type CatalogBook } from '../data/catalog'
import { useProgress } from '../hooks/useProgress'
import { useTTS } from '../hooks/useTTS'
import AudioControls from './AudioControls'

interface Chapter {
  title: string
  content: string
}

interface ReaderProps {
  book: CatalogBook
  onBack: () => void
}

export default function Reader({ book, onBack }: ReaderProps) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { progress, updateProgress } = useProgress(book.id)
  const [currentChapter, setCurrentChapter] = useState(progress.chapter)
  const [showChapterList, setShowChapterList] = useState(false)
  const restoredRef = useRef(false)

  // Load book content
  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(book.contentPath)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load book')
        return r.json()
      })
      .then((data: { chapters: Chapter[] }) => {
        setChapters(data.chapters)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [book.contentPath])

  // Get paragraphs from current chapter
  const paragraphs = chapters[currentChapter]?.content.split('\n').filter(p => p.trim()) || []

  const tts = useTTS(paragraphs, progress.paragraph)
  const { isPlaying, currentParagraph, setCurrentParagraph } = tts

  const goToChapter = useCallback((index: number) => {
    tts.stop()
    setCurrentChapter(index)
    updateProgress(index)
    tts.setCurrentParagraph(0)
    window.scrollTo({ top: 0 })
  }, [tts, updateProgress])

  const prevChapter = useCallback(() => {
    if (currentChapter > 0) goToChapter(currentChapter - 1)
  }, [currentChapter, goToChapter])

  const nextChapter = useCallback(() => {
    if (currentChapter < chapters.length - 1) goToChapter(currentChapter + 1)
  }, [currentChapter, chapters.length, goToChapter])

  // Save chapter + paragraph so reopening the book lands where the reader left off
  useEffect(() => {
    if (chapters.length > 0) {
      updateProgress(currentChapter, currentParagraph)
    }
  }, [currentChapter, currentParagraph, chapters.length, updateProgress])

  // On first load, scroll to the saved paragraph
  useEffect(() => {
    if (loading || restoredRef.current) return
    restoredRef.current = true
    if (progress.paragraph > 0) {
      document.querySelector(`[data-p="${progress.paragraph}"]`)?.scrollIntoView({ block: 'start' })
    }
  }, [loading, progress.paragraph])

  // While reading (not listening), the paragraph at the top of the screen is the position
  useEffect(() => {
    if (loading || isPlaying) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-p]'))) {
          if (el.getBoundingClientRect().bottom > 80) {
            setCurrentParagraph(Number(el.dataset.p))
            return
          }
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [loading, isPlaying, setCurrentParagraph])

  // While listening, keep the paragraph being read on screen
  useEffect(() => {
    if (!isPlaying) return
    document.querySelector(`[data-p="${currentParagraph}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [isPlaying, currentParagraph])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-warm-800/50 dark:text-warm-100/50">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-warm-800/70 dark:text-warm-100/70">{error}</p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-warm-200 dark:bg-warm-800 text-warm-800 dark:text-warm-100"
        >
          Back to Library
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-warm-50/90 dark:bg-warm-950/90 backdrop-blur-sm border-b border-warm-200 dark:border-warm-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => { tts.stop(); onBack() }}
            className="p-1.5 rounded-lg hover:bg-warm-200 dark:hover:bg-warm-800 transition-colors"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-warm-800 dark:text-warm-100">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warm-800 dark:text-warm-100 truncate">{book.title}</p>
            <p className="text-xs text-warm-800/50 dark:text-warm-100/50">{book.author}</p>
          </div>
          <button
            onClick={() => setShowChapterList(!showChapterList)}
            className="p-1.5 rounded-lg hover:bg-warm-200 dark:hover:bg-warm-800 transition-colors text-xs text-warm-800/70 dark:text-warm-100/70"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Chapter list dropdown */}
      {showChapterList && (
        <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setShowChapterList(false)}>
          <div
            className="absolute top-14 right-4 w-72 max-h-[70vh] overflow-y-auto bg-warm-50 dark:bg-warm-900 rounded-lg shadow-xl border border-warm-200 dark:border-warm-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-warm-200 dark:border-warm-800">
              <p className="text-xs font-semibold text-warm-800/60 dark:text-warm-100/60 uppercase tracking-wide">
                Chapters
              </p>
            </div>
            <div className="p-2">
              {chapters.map((ch, i) => (
                <button
                  key={i}
                  onClick={() => { goToChapter(i); setShowChapterList(false) }}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    i === currentChapter
                      ? 'bg-warm-200 dark:bg-warm-800 text-warm-800 dark:text-warm-100 font-medium'
                      : 'text-warm-800/70 dark:text-warm-100/70 hover:bg-warm-200/50 dark:hover:bg-warm-800/50'
                  }`}
                >
                  <span className="text-xs text-warm-800/40 dark:text-warm-100/40 mr-2">{i + 1}.</span>
                  {ch.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 pb-32">
        {chapters[currentChapter] && (
          <>
            <h2 className="text-lg font-bold text-warm-800 dark:text-warm-100 mb-6">
              {chapters[currentChapter].title}
            </h2>
            <div className="space-y-4">
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  data-p={i}
                  className={`scroll-mt-20 text-sm leading-relaxed transition-colors cursor-pointer ${
                    tts.isPlaying && i === tts.currentParagraph
                      ? 'text-warm-800 dark:text-warm-100 bg-warm-200/50 dark:bg-warm-800/30 -mx-2 px-2 py-1 rounded'
                      : 'text-warm-800/80 dark:text-warm-100/80'
                  }`}
                  onClick={() => {
                    tts.setCurrentParagraph(i)
                    if (tts.isPlaying) {
                      tts.play(i)
                    }
                  }}
                >
                  {p}
                </p>
              ))}
            </div>

            {/* Chapter navigation at bottom of content */}
            <div className="flex justify-between mt-10 pt-6 border-t border-warm-200 dark:border-warm-800">
              <button
                onClick={prevChapter}
                disabled={currentChapter === 0}
                className="text-sm text-warm-800/60 dark:text-warm-100/60 hover:text-warm-800 dark:hover:text-warm-100 disabled:opacity-30 transition-colors"
              >
                Previous Chapter
              </button>
              <button
                onClick={nextChapter}
                disabled={currentChapter >= chapters.length - 1}
                className="text-sm text-warm-800/60 dark:text-warm-100/60 hover:text-warm-800 dark:hover:text-warm-100 disabled:opacity-30 transition-colors"
              >
                Next Chapter
              </button>
            </div>
          </>
        )}
      </main>

      {/* Audio controls */}
      <AudioControls
        isPlaying={tts.isPlaying}
        rate={tts.rate}
        voice={tts.voice}
        voices={tts.voices}
        engine={tts.engine}
        kokoroVoice={tts.kokoroVoice}
        currentChapter={currentChapter}
        totalChapters={chapters.length}
        bookTitle={book.title}
        onToggle={tts.toggle}
        onPrevChapter={prevChapter}
        onNextChapter={nextChapter}
        onChangeRate={tts.changeRate}
        onChangeVoice={tts.changeVoice}
        onChangeEngine={tts.changeEngine}
        onChangeKokoroVoice={tts.changeKokoroVoice}
      />
    </div>
  )
}
