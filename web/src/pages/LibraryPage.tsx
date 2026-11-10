import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { BookCover } from '../components/BookCover'
import { CATALOG } from '../data/catalog'
import { readPath } from '../data/book'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { booksInProgress, progressPercent, setFinished, useFinished } from '../hooks/useReadingProgress'
import { ListenButton } from '../components/ListenButton'
import { AnnotationList } from '../components/Annotations'
import { annotationsMarkdown, downloadMarkdown, useAllAnnotations } from '../hooks/annotations'
import { isNarrated, usePreparedManifest } from '../hooks/preparedAudio'
import {
  checkSavedText, fetchChapters, formatBytes, removeSavedBook, saveBook, savedAudioChapters, savedBytes, updateReason,
  useOfflineBooks, useOnline, usePlayableManifest,
} from '../hooks/offlineBooks'

/**
 * Safari on iPhone and iPad, not opened from the Home Screen: it deletes a
 * site's storage after about 7 days without a visit (books#24).
 */
const iosSafariTab = (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)
  && !(navigator as Navigator & { standalone?: boolean }).standalone
  && !window.matchMedia?.('(display-mode: standalone)').matches

/** My books: what is saved on this device and what is being read or listened to. */
export function LibraryPage() {

  return (
    <div className="min-h-dvh bg-page text-text">
      <NavBar title="My books" />

      <main className="min-w-0 [overflow-wrap:anywhere] max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <InProgress />
        <Finished />
        <BookNotes />
        <SavedBooks />
      </main>
    </div>
  )
}

/** Books with a reading or listening position, latest first (books#13). */
function InProgress() {
  const { history } = useAudioPlayer()
  const manifest = usePreparedManifest()
  // Offline, only books saved on this device can be listened to (books#24), as PlayButton
  const playable = usePlayableManifest()
  const finished = useFinished()
  const books = booksInProgress(history, manifest, finished)
    .flatMap(p => {
      const book = CATALOG.find(b => b.id === p.slug)
      return book ? [{ book, progress: p }] : []
    })

  return (
    <section className="bg-surface rounded-xl border border-border p-5 md:p-6 mb-6">
      <h2 className="text-lg font-display mb-3">In progress</h2>
      {books.length === 0 ? (
        <p className="text-sm text-text-muted">
          Books you start reading or listening to show up here. <Link to="/" className="text-accent underline">Browse books</Link>
        </p>
      ) : (
        <div className="divide-y divide-border">
          {books.map(({ book, progress }) => (
            <div key={book.id} className="py-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 md:flex md:items-center">
              <BookCover book={book} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{book.title}</div>
                <div className="text-xs text-text-dim mt-0.5">{book.author} · Chapter {progress.chapterIdx + 1} of {book.chapters}</div>
                <div className="mt-1.5 h-1 max-w-48 bg-surface-hover rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full" style={{ width: `${progressPercent(progress)}%` }} />
                </div>
                <div className="text-xs text-text-dim mt-1">
                  {Math.round(progress.read * 100)}% read
                  {progress.listened !== null && ` · ${Math.round(progress.listened * 100)}% listened`}
                </div>
                <button onClick={() => setFinished(book.id, true)} className="min-h-10 text-xs text-text-muted hover:text-text transition">
                  Mark as finished
                </button>
              </div>
              <div className="col-span-2 min-w-0 flex flex-wrap items-center justify-end gap-2 md:shrink-0 md:flex-col md:items-end">
                <Link to={readPath(book.id)} className="min-h-10 inline-flex items-center rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-btn-text hover:bg-accent-hover transition">
                  Resume
                </Link>
                {playable && isNarrated(playable, book.id) && (
                  <ListenButton book={book} className="min-h-10 inline-flex items-center rounded-lg border border-border px-4 py-1.5 text-xs font-semibold text-text-muted hover:text-text transition" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Books marked finished, latest first. */
function Finished() {
  const finished = useFinished()
  const books = Object.entries(finished)
    .sort((a, b) => b[1] - a[1])
    .flatMap(([slug]) => CATALOG.filter(b => b.id === slug))
  if (books.length === 0) return null

  return (
    <section className="bg-surface rounded-xl border border-border p-5 md:p-6 mb-6">
      <h2 className="text-lg font-display mb-3">Finished</h2>
      <div className="divide-y divide-border">
        {books.map(book => (
          <div key={book.id} className="py-3 flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-3">
            <div className="min-w-0 flex-1">
              <Link to={readPath(book.id)} className="text-sm font-medium hover:text-accent transition">{book.title}</Link>
              <div className="text-xs text-text-dim mt-0.5">{book.author}</div>
            </div>
            <button onClick={() => setFinished(book.id, false)} className="min-h-10 text-left md:shrink-0 text-xs text-text-muted hover:text-text transition">
              Not finished
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Every book's bookmarks, highlights and notes (books#11). */
function BookNotes() {
  const all = useAllAnnotations()
  const navigate = useNavigate()
  const books = CATALOG.filter(b => all[b.id]?.length)
  if (books.length === 0) return null

  const exportBook = async (slug: string, title: string, author: string) => {
    // Chapter titles from the book, when it can be loaded
    const titles = await fetchChapters(CATALOG.find(b => b.id === slug)!.contentPath)
      .then(chapters => chapters.map(c => c.title), () => [])
    downloadMarkdown(`${slug}-notes.md`, annotationsMarkdown(title, author, titles, all[slug]))
  }

  return (
    <section className="bg-surface rounded-xl border border-border p-5 md:p-6 mb-6">
      <h2 className="text-lg font-display mb-3">Bookmarks and notes</h2>
      <div className="divide-y divide-border">
        {books.map(book => (
          <details key={book.id} className="py-2 group">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{book.title}</span>
                <span className="block text-xs text-text-dim">{all[book.id].length} saved</span>
              </span>
              <span className="shrink-0 text-text-dim text-xs group-open:rotate-180 transition" aria-hidden="true">&#9662;</span>
            </summary>
            <div className="mt-1">
              <AnnotationList
                slug={book.id}
                list={all[book.id]}
                chapterTitles={[]}
                onJump={a => navigate(`${readPath(book.id)}?ch=${a.chapterIdx}&at=${a.start}`)}
              />
              <button
                onClick={() => exportBook(book.id, book.title, book.author)}
                className="mt-2 text-xs text-accent hover:underline"
              >
                Export Markdown
              </button>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

/** Books saved on this device for offline reading and listening (books#7). */
function SavedBooks() {
  const { saved, jobs, errors } = useOfflineBooks()
  const manifest = usePreparedManifest()
  const online = useOnline()
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const slugs = [...new Set([...Object.keys(saved), ...Object.keys(jobs), ...Object.keys(errors)])]

  useEffect(() => {
    if (online) for (const slug of Object.keys(saved)) checkSavedText(slug)
  }, [saved, online])

  useEffect(() => {
    const storageApi = navigator.storage
    if (!storageApi?.estimate) return
    Promise.all([storageApi.estimate(), storageApi.persisted?.() ?? false])
      .then(([estimate, persisted]) => setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted }))
      .catch(() => {})
  }, [saved, jobs])

  return (
    <section className="bg-surface rounded-xl border border-border p-5 md:p-6 mb-6">
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-start md:justify-between md:gap-3 mb-3">
        <h2 className="text-lg font-display">Saved on this device</h2>
        {storage && Object.keys(saved).length > 0 && (
          <div className="min-w-0 text-xs text-text-dim md:max-w-[55%] md:text-right">
            {formatBytes(storage.usage)} used{storage.quota > 0 && ` of ${formatBytes(storage.quota)}`}
            <div>{storage.persisted ? 'Kept until you remove them' : 'Your browser may remove them if the device runs low on space'}</div>
          </div>
        )}
      </div>
      {iosSafariTab && (
        <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          Safari deletes saved books after about a week without opening this site. To keep them, add it to your
          Home Screen (Share, then Add to Home Screen) and open it from there.
        </p>
      )}
      {slugs.length === 0 ? (
        <p className="text-sm text-text-muted">
          Open a book and tap "Save offline" to read and listen without a connection.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {slugs.map(slug => {
            const book = saved[slug]
            const job = jobs[slug]
            const catalogBook = CATALOG.find(b => b.id === slug)
            const chapters = catalogBook?.chapters ?? 0
            const audio = book ? savedAudioChapters(book) : 0
            const reason = book && manifest ? updateReason(slug, book, manifest) : null
            return (
              <div key={slug} className="py-3 flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={readPath(slug)} className="text-sm font-medium hover:text-accent transition">
                    {catalogBook?.title ?? slug}
                  </Link>
                  <div className="text-xs text-text-dim mt-0.5">
                    {job
                      ? `Saving… ${Math.round(job.progress * 100)}%`
                      : book && `${formatBytes(savedBytes(book))} · ${book.voice ? `${audio}/${chapters} chapters with audio` : 'Text only'}`}
                  </div>
                  {!job && errors[slug] && <div role="alert" className="text-xs text-danger mt-0.5">{errors[slug]}</div>}
                  {job && (
                    <div className="mt-1.5 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
                {job ? (
                  <button onClick={job.cancel} className="min-h-10 px-2 text-left text-xs text-text-muted hover:text-danger transition md:shrink-0">Cancel</button>
                ) : (
                  <div className="min-w-0 max-w-full flex flex-wrap items-center gap-1 md:shrink-0">
                    {reason && online && (
                      <button onClick={() => saveBook(slug, book.voice)} className="max-w-full min-h-10 px-2 text-left text-xs text-accent hover:underline">
                        Update ({reason})
                      </button>
                    )}
                    {book && (
                      <button onClick={() => removeSavedBook(slug)} className="min-h-10 px-2 text-xs text-text-muted hover:text-danger transition">Remove</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
