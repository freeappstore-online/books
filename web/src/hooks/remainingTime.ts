/** Reading estimates use about 250 words a minute (six characters per word). */
const READ_CHARS_PER_SECOND = 25

/** Keep reading progress and listening progress separate, especially for partial audiobooks. */
export function remainingTime(
  chapters: { content: string }[], durations: (number | null)[], chapterIdx: number,
  scroll: number, rate: number, playedSeconds: number,
) {
  const fraction = Math.min(1, Math.max(0, scroll))
  const readingChapter = chapters[chapterIdx].content.length / READ_CHARS_PER_SECOND * (1 - fraction)
  const readingBook = readingChapter + chapters.slice(chapterIdx + 1)
    .reduce((sum, c) => sum + c.content.length / READ_CHARS_PER_SECOND, 0)
  const duration = durations[chapterIdx] ?? null
  const audioChapter = duration === null ? null : Math.max(0, duration - Math.max(0, playedSeconds)) / rate
  const audioBook = (audioChapter ?? 0) + chapters.slice(chapterIdx + 1)
    .reduce((sum, _, i) => sum + (durations[chapterIdx + 1 + i] ?? 0) / rate, 0)
  const partial = chapters.some((_, i) => durations[i] == null)
  return { readingChapter, readingBook, audioChapter, audioBook, partial }
}
