import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useNarrationPosition } from '../hooks/narration'
import { chapterSeconds, isNarrated, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'

/** Reading speed for books without narration: about 250 words a minute */
const READ_CHARS_PER_SECOND = 25

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
 * Time left in the chapter and the book (books#13): from the narration's lengths at
 * the listening speed when the book is narrated, else from the text at a reading pace.
 */
export function TimeLeft({ slug, chapters, chapterIdx, scroll }: Props) {
  const manifest = usePreparedManifest()
  const player = useAudioPlayer()
  const position = useNarrationPosition()
  if (!chapters[chapterIdx]) return null
  const narrated = Boolean(manifest && isNarrated(manifest, slug))
  const seconds = (i: number) => {
    const narration = narrated ? chapterSeconds(manifest!, slug, i) : null
    return narration !== null ? narration / player.rate : chapters[i].content.length / READ_CHARS_PER_SECOND
  }
  // Listening to this chapter: where the narration is; otherwise where the reader is
  const url = narrated ? preparedUrl(slug, chapterIdx) : null
  const listening = player.book?.slug === slug && player.playing && position.url === url && position.duration > 0
  const done = listening ? position.time / position.duration : scroll
  const chapterLeft = seconds(chapterIdx) * (1 - Math.min(1, Math.max(0, done)))
  let bookLeft = chapterLeft
  for (let i = chapterIdx + 1; i < chapters.length; i++) bookLeft += seconds(i)

  return (
    <p
      className="text-xs text-text-dim mb-4 md:mb-6"
      title={narrated ? `Listening time at ${player.rate}× speed` : 'Estimated reading time'}
    >
      {formatDuration(chapterLeft)} left in chapter
      {chapters.length > 1 && <> · {formatDuration(bookLeft)} left in book</>}
    </p>
  )
}
