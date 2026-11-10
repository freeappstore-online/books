import { describe, expect, it } from 'vitest'
import { remainingTime } from '../../src/hooks/remainingTime'

const chapters = [{ content: 'a'.repeat(3000) }, { content: 'b'.repeat(15000) }, { content: 'c'.repeat(6000) }]

describe('reading and listening time', () => {
  it('excludes missing narration from available listening time, retaining the whole reading estimate', () => {
    expect(remainingTime(chapters, [300, null, 600], 0, 0.5, 2, 60)).toEqual({
      readingChapter: 60, readingBook: 900, audioChapter: 120, audioBook: 420, partial: true,
    })
  })

  it('shows no chapter audio on a reading-only chapter and counts only future available audio', () => {
    expect(remainingTime(chapters, [300, null, 600], 1, 0, 1, 0)).toEqual({
      readingChapter: 600, readingBook: 840, audioChapter: null, audioBook: 600, partial: true,
    })
  })

  it('keeps the listening position independent of reading scroll and handles the chapter ending', () => {
    const paused = remainingTime(chapters, [300, 300, 600], 0, 0, 1, 90)
    const scrolled = remainingTime(chapters, [300, 300, 600], 0, 1, 1, 90)
    expect(scrolled.audioBook).toBe(paused.audioBook)
    expect(scrolled.readingBook).toBe(paused.readingBook - 120)
    expect(paused.partial).toBe(false)
    expect(remainingTime(chapters, [300, 300, 600], 2, 0, 2, 601).audioBook).toBe(0)
  })
})
