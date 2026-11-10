import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { getNarrationTime, useNarrationPosition } from '../hooks/narration'
import { chapterSeconds, isNarrated, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'
import { remainingTime } from '../hooks/remainingTime'

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

interface Props {
  slug: string
  chapters: { content: string }[]
  chapterIdx: number
  /** How far down the chapter the reader has scrolled, 0–1 */
  scroll: number
}

/**
 * Reading and listening have separate positions and speeds. Missing audio never
 * contributes a reading estimate to the listening total.
 */
export function TimeLeft({ slug, chapters, chapterIdx, scroll }: Props) {
  const manifest = usePreparedManifest()
  const player = useAudioPlayer()
  const position = useNarrationPosition()
  if (!chapters[chapterIdx]) return null
  const narrated = Boolean(manifest && isNarrated(manifest, slug))
  const url = narrated ? preparedUrl(slug, chapterIdx) : null
  // Pausing keeps the audio's position; scrolling only changes the reading estimate.
  const played = url ? position.url === url && position.duration > 0 ? position.time : getNarrationTime(url) : 0
  const times = remainingTime(chapters, chapters.map((_, i) => manifest ? chapterSeconds(manifest, slug, i) : null),
    chapterIdx, scroll, player.rate, played)

  return (
    <p
      className="text-xs text-text-dim mb-4 md:mb-6"
    >
      <span className="block" title="Estimated reading time">
        Reading: {formatDuration(times.readingChapter)} left in chapter
        {chapters.length > 1 && <> · {formatDuration(times.readingBook)} left in book</>}
      </span>
      {narrated && <span className="block">
        Listening at {player.rate}×: {times.audioChapter === null ? 'no audio for this chapter' : `${formatDuration(times.audioChapter)} left in chapter`}
        {chapters.length > 1 && <> · {formatDuration(times.audioBook)} {times.partial ? 'available audio left' : 'left in book'}</>}
      </span>}
    </p>
  )
}
