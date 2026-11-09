import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { preparedCount, usePreparedManifest, VOICE } from '../hooks/preparedAudio'
import {
  checkSavedText, estimateAudioBytes, formatBytes, saveBook, updateReason, useOfflineBooks, useOnline,
} from '../hooks/offlineBooks'

/**
 * Save a book on this device (books#7). A narrated book saves its text and
 * every narrated chapter; a book without narration saves its text only.
 */
export function SaveOfflineButton({ slug }: { slug: string }) {
  const { saved, jobs, errors } = useOfflineBooks()
  const saving = Boolean(jobs[slug])
  const wasSaving = useRef(saving)
  const [status, setStatus] = useState('')

  // Announce when saving starts and how it ends, not every percent (books#15)
  useEffect(() => {
    if (saving === wasSaving.current) return
    wasSaving.current = saving
    setStatus(saving ? 'Saving for offline' : saved[slug] ? 'Saved for offline' : errors[slug] ? 'Saving failed' : 'Saving cancelled')
  }, [saving, saved, errors, slug])

  return (
    <>
      <SaveOfflineControl slug={slug} />
      <span role="status" className="sr-only">{status}</span>
    </>
  )
}

function SaveOfflineControl({ slug }: { slug: string }) {
  const { saved, jobs, errors } = useOfflineBooks()
  const manifest = usePreparedManifest()
  const online = useOnline()
  const job = jobs[slug]
  const book = saved[slug]

  useEffect(() => { if (online) checkSavedText(slug) }, [slug, online])

  if (job) {
    return (
      <button
        onClick={job.cancel}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/20 text-accent hover:bg-danger/20 hover:text-danger transition"
        title="Cancel saving"
      >
        Saving {Math.round(job.progress * 100)}% · Cancel
      </button>
    )
  }

  // Until the manifest loads it isn't known whether the book has narration
  if (!manifest) return null
  const narrated = preparedCount(manifest, slug)

  if (book) {
    const reason = updateReason(slug, book, manifest)
    if (reason && online) {
      return (
        <button
          onClick={() => saveBook(slug, book.voice)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-accent hover:text-text transition"
          title={`Download what the saved copy is missing: ${reason}`}
        >
          {errors[slug] ? '↻ Retry update' : '↓ Update saved book'}
        </button>
      )
    }
    return (
      <Link
        to="/library"
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-success/15 text-success transition"
        title="Saved on this device: manage it in My books"
      >
        ✓ Saved offline
      </Link>
    )
  }

  if (!online) return null
  const estimate = estimateAudioBytes(manifest, slug, VOICE)
  return (
    <button
      onClick={() => saveBook(slug, VOICE)}
      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-text-muted hover:text-accent transition"
      title={narrated > 0 ? 'Download the text and narration to read and listen offline' : 'Download the text to read offline'}
    >
      {errors[slug] ? '↻ Retry save' : narrated > 0 ? `↓ Save offline · ~${formatBytes(estimate)}` : '↓ Save to read offline'}
    </button>
  )
}

/** Why the last save or update of this book failed, under the reader's header. */
export function SaveOfflineError({ slug }: { slug: string }) {
  const { errors, jobs } = useOfflineBooks()
  if (!errors[slug] || jobs[slug]) return null
  return (
    <div role="alert" className="border-b border-border bg-danger/10 px-4 py-3 text-center text-sm text-danger">
      Couldn't save this book: {errors[slug]}
    </div>
  )
}
