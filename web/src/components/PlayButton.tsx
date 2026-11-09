import { useAudioPlayer, type AudioChapter } from '../hooks/useAudioPlayer'
import { isNarrated } from '../hooks/preparedAudio'
import { usePlayableManifest } from '../hooks/offlineBooks'

interface Props {
  slug: string
  bookTitle: string
  bookAuthor: string
  chapters: AudioChapter[]
  activeChapterIdx: number
}

/** The one way to listen: plays the book's narration from the chapter on screen. */
export function PlayButton({ slug, bookTitle, bookAuthor, chapters, activeChapterIdx }: Props) {
  const player = useAudioPlayer()
  // Offline, only books saved on this device (books#24)
  const manifest = usePlayableManifest()
  const isPlaying = player.book?.slug === slug && player.playing

  // Books without narration are reading-only; nothing shows until the manifest says which
  if (!manifest || !isNarrated(manifest, slug)) return null

  return (
    <button
      onClick={() => isPlaying
        ? player.pause()
        : player.loadAndPlay({ slug, title: bookTitle, author: bookAuthor, chapters }, activeChapterIdx)}
      data-shortcut="play"
      aria-keyshortcuts="Space K"
      className="min-h-10 px-4 py-1.5 rounded-lg font-semibold text-sm bg-accent hover:bg-accent-hover text-btn-text transition"
    >
      {isPlaying ? 'Pause' : 'Play'}
    </button>
  )
}
