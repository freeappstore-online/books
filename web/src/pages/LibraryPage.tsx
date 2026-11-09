import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { BookCover } from '../components/BookCover'
import { CATALOG } from '../data/catalog'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { getAllProgress } from '../hooks/useReadingProgress'
import { usePreparedManifest } from '../hooks/preparedAudio'
import {
  checkSavedText, formatBytes, removeSavedBook, saveBook, savedAudioChapters, savedBytes, updateReason,
  useOfflineBooks, useOnline,
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
  const player = useAudioPlayer()

  return (
    <div className={`min-h-dvh bg-page text-text ${player.book ? 'pb-20' : ''}`}>
      <NavBar title="My books" />

      <main className="max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <SavedBooks />
        <InProgress />
      </main>
    </div>
  )
}

/** Books with a reading or listening position, latest first. */
function InProgress() {
  const { history } = useAudioPlayer()
  const reading = getAllProgress()
  const latest = new Map<string, { chapterIdx: number; at: number }>()
  for (const [slug, p] of Object.entries(reading)) latest.set(slug, { chapterIdx: p.chapterIdx, at: p.lastRead })
  for (const h of history) {
    if (h.timestamp > (latest.get(h.slug)?.at ?? 0)) latest.set(h.slug, { chapterIdx: h.chapterIdx, at: h.timestamp })
  }
  const books = [...latest.entries()]
    .map(([slug, p]) => ({ ...p, book: CATALOG.find(b => b.id === slug) }))
    .filter(e => e.book)
    .sort((a, b) => b.at - a.at)

  return (
    <section className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-display mb-3">In progress</h2>
      {books.length === 0 ? (
        <p className="text-sm text-text-muted">
          Books you start reading or listening to show up here. <Link to="/" className="text-accent underline">Browse books</Link>
        </p>
      ) : (
        <div className="divide-y divide-border">
          {books.map(({ book, chapterIdx }) => (
            <div key={book!.id} className="py-3 flex items-center gap-3">
              <BookCover book={book!} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{book!.title}</div>
                <div className="text-xs text-text-dim mt-0.5">{book!.author} · Chapter {chapterIdx + 1} of {book!.chapters}</div>
              </div>
              <Link to={`/read/${book!.id}`} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-btn-text hover:bg-accent-hover transition">
                Resume
              </Link>
            </div>
          ))}
        </div>
      )}
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
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="text-lg font-display">Saved on this device</h2>
        {storage && Object.keys(saved).length > 0 && (
          <div className="text-xs text-text-dim text-right">
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
              <div key={slug} className="py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/read/${slug}`} className="text-sm font-medium hover:text-accent transition">
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
                  <button onClick={job.cancel} className="text-xs text-text-muted hover:text-danger transition shrink-0">Cancel</button>
                ) : (
                  <div className="flex items-center gap-3 shrink-0">
                    {reason && online && (
                      <button onClick={() => saveBook(slug, book.voice)} className="text-xs text-accent hover:underline">
                        Update ({reason})
                      </button>
                    )}
                    {book && (
                      <button onClick={() => removeSavedBook(slug)} className="text-xs text-text-muted hover:text-danger transition">Remove</button>
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
