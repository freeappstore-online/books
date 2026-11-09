import { Link } from 'react-router-dom'
import { preparedCount, usePreparedManifest, VOICE } from '../hooks/preparedAudio'
import {
  estimateAudioBytes, formatBytes, saveBook, savedAudioChapters, useOfflineBooks, useOnline,
} from '../hooks/offlineBooks'

/**
 * Save a book on this device (books#7). A narrated book saves its text and
 * every narrated chapter; a book without narration saves its text only.
 */
export function SaveOfflineButton({ slug }: { slug: string }) {
  const { saved, jobs, errors } = useOfflineBooks()
  const manifest = usePreparedManifest()
  const online = useOnline()
  const job = jobs[slug]
  const book = saved[slug]

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
    const newChapters = book.voice ? narrated - savedAudioChapters(book) : 0
    if (newChapters > 0 && online) {
      return (
        <button
          onClick={() => saveBook(slug, book.voice!)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-accent hover:text-text transition"
          title={`${newChapters} newly narrated chapter${newChapters === 1 ? '' : 's'} to download`}
        >
          ↓ Update saved book
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
      title={errors[slug] ? `Last attempt failed: ${errors[slug]}` : narrated > 0
        ? 'Download the text and narration to read and listen offline'
        : 'Download the text to read offline'}
    >
      {errors[slug] ? '↻ Retry save' : narrated > 0 ? `↓ Save offline · ~${formatBytes(estimate)}` : '↓ Save to read offline'}
    </button>
  )
}
