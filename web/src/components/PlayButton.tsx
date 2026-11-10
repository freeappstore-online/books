import { useAudioPlayer, type AudioChapter } from '../hooks/useAudioPlayer'
import { chapterSeconds, isNarrated, usePreparedManifest } from '../hooks/preparedAudio'
import { usePlayableManifest } from '../hooks/offlineBooks'

interface Props {
  slug: string
  bookTitle: string
  bookAuthor: string
  chapters: AudioChapter[]
  activeChapterIdx: number
}

/** The one way to listen: plays the narration of the chapter on screen. */
export function PlayButton({ slug, bookTitle, bookAuthor, chapters, activeChapterIdx }: Props) {
  const player = useAudioPlayer()
  // Offline, only books saved on this device (books#24)
  const manifest = usePlayableManifest()
  const full = usePreparedManifest()
  const isPlaying = player.book?.slug === slug && player.playing

  // Books without narration are reading-only, and so are the chapters without it of a partly
  // narrated book (books#31); nothing shows until the manifest says which. A narrated chapter not
  // saved offline keeps Play, which explains why it can't play.
  if (!isPlaying && (!manifest || !full || !isNarrated(manifest, slug) || chapterSeconds(full, slug, activeChapterIdx) === null)) return null

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
