import { createContext, useContext, useState, useCallback, useRef, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { getNarrationTime, playNarration, primeNarration, seekNarration, type Narration } from './narration'
import { chapterSeconds, getLoadedManifest, isNarrated, loadPreparedManifest, preparedUrl } from './preparedAudio'
import {
  loadRate, saveRate, loadHistory, saveHistory, loadPosition, savePosition, saveSleepChoice,
  type HistoryEntry,
} from './audioStorage'
import {
  loadTimings, positionFromTimings, positionByProportion, sentenceRanges, timeForChar,
  type CharRange, type ReadAlongPosition, type TimingSegment,
} from './readAlong'

export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2, 2.5, 3]

/** Sleep after this many minutes of playback, or at the end of the chapter. */
export type SleepChoice = number | 'chapter'

export interface SleepTimer {
  choice: SleepChoice
  /** Playback time left, in ms (minutes timers only) */
  remaining: number
}

// The sleep timer fades the volume out over its last seconds
const SLEEP_FADE_MS = 10_000

export interface AudioChapter {
  id: string
  title: string
  content: string
}

export interface AudioBook {
  slug: string
  title: string
  author: string
  chapters: AudioChapter[]
}

interface AudioPlayerState {
  book: AudioBook | null
  playing: boolean
  /** Playing was asked for and the audio hasn't started yet */
  loading: boolean
  chapterIdx: number
  rate: number
  history: HistoryEntry[]
  /**
   * Play `book` from `chapterIdx` (default: the chapter listened to last), where
   * that chapter was stopped, or from the word at `charOffset`. A word of the
   * chapter playing just seeks there.
   */
  loadAndPlay: (book: AudioBook, chapterIdx?: number, charOffset?: number) => void
  play: () => void
  pause: () => void
  setChapter: (idx: number) => void
  nextChapter: () => void
  prevChapter: () => void
  /** Jump `seconds` forward (or back, if negative) in the chapter */
  skip: (seconds: number) => void
  /** Move the current chapter to `seconds` */
  seek: (seconds: number) => void
  sleepTimer: SleepTimer | null
  startSleepTimer: (choice: SleepChoice) => void
  /** Add minutes to a running timer */
  extendSleepTimer: (minutes: number) => void
  cancelSleepTimer: () => void
  setRate: (rate: number) => void
  /** Read-along position, outside React state so it can change many times a second. */
  subscribeReadAlong: (listener: () => void) => () => void
  getReadAlong: () => ReadAlongPosition | null
}

const AudioPlayerContext = createContext<AudioPlayerState | null>(null)

function sameRange(a: CharRange | null, b: CharRange | null) {
  return a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<AudioBook | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [chapterIdx, setChapterIdx] = useState(0)
  const [rate, setRateState] = useState(loadRate)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [sleepTimer, setSleepTimer] = useState<SleepTimer | null>(null)
  const sleepTimerRef = useRef(sleepTimer)
  sleepTimerRef.current = sleepTimer
  // Playback volume, lowered by the sleep timer's fade
  const volumeRef = useRef(1)

  const bookRef = useRef(book)
  const chapterIdxRef = useRef(chapterIdx)
  const rateRef = useRef(rate)
  bookRef.current = book
  chapterIdxRef.current = chapterIdx
  rateRef.current = rate
  // Generation counter: bumped whenever playback is halted, so callbacks from
  // the halted chapter are ignored.
  const genRef = useRef(0)
  const narrationRef = useRef<Narration | null>(null)
  // The chapter playing, for read-along and seeking to a word (timings undefined while loading)
  const trackRef = useRef<{ audio: HTMLAudioElement; idx: number; text: string; timings?: TimingSegment[] | null } | null>(null)

  useEffect(() => () => { narrationRef.current?.stop() }, [])

  const readAlongRef = useRef<ReadAlongPosition | null>(null)
  const readAlongListenersRef = useRef(new Set<() => void>())
  const setReadAlong = useCallback((pos: ReadAlongPosition | null) => {
    const prev = readAlongRef.current
    if (prev === pos || (prev && pos && prev.chapterIdx === pos.chapterIdx
      && sameRange(prev.sentence, pos.sentence) && sameRange(prev.word, pos.word))) return
    readAlongRef.current = pos
    for (const listener of readAlongListenersRef.current) listener()
  }, [])
  const subscribeReadAlong = useCallback((listener: () => void) => {
    readAlongListenersRef.current.add(listener)
    return () => { readAlongListenersRef.current.delete(listener) }
  }, [])
  const getReadAlong = useCallback(() => readAlongRef.current, [])

  /** Stop the audio and invalidate its pending callbacks; returns the new generation. */
  const halt = useCallback(() => {
    const gen = ++genRef.current
    narrationRef.current?.stop()
    narrationRef.current = null
    setLoading(false)
    trackRef.current = null
    setReadAlong(null)
    return gen
  }, [setReadAlong])

  /** Follow the audio element of chapter `idx` until playback is halted. */
  const followNarration = useCallback((gen: number, b: AudioBook, idx: number, audio: HTMLAudioElement) => {
    const text = b.chapters[idx].content
    const track: NonNullable<typeof trackRef.current> = { audio, idx, text }
    trackRef.current = track
    loadTimings(b.slug, idx).then(t => { track.timings = t })
    let sentences: CharRange[] | null = null
    // currentTime has no change event finer than timeupdate (4 Hz): read it each frame.
    // setReadAlong only notifies when the word or sentence changes.
    const tick = () => {
      if (gen !== genRef.current || audio.ended) return
      if (audio.readyState > 0 && !audio.seeking && track.timings !== undefined) {
        const t = audio.currentTime
        if (track.timings) {
          setReadAlong({ chapterIdx: idx, ...positionFromTimings(text, track.timings, t) })
        } else {
          sentences ??= sentenceRanges(text)
          setReadAlong({ chapterIdx: idx, sentence: positionByProportion(text, sentences, t, audio.duration), word: null })
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [setReadAlong])

  // startPlayback and finishChapter call each other
  const finishChapterRef = useRef<(idx: number) => void>(() => {})

  /**
   * Play chapter `idx` of the current book, from where it was stopped or from
   * the word at `charOffset`. Chapters without narration are passed over in
   * the direction of travel; when none is left that way, nothing changes.
   */
  const startPlayback = useCallback(async (start: number, charOffset?: number, dir: 1 | -1 = 1) => {
    const b = bookRef.current
    if (!b || start < 0 || start >= b.chapters.length) return
    const gen = halt()
    // Synchronously, while this is still the user's click (iOS)
    primeNarration()
    setPlaying(true)
    setLoading(true)

    const manifest = await loadPreparedManifest()
    if (gen !== genRef.current) return
    let idx = start
    while (idx >= 0 && idx < b.chapters.length && chapterSeconds(manifest, b.slug, idx) === null) idx += dir
    if (idx < 0 || idx >= b.chapters.length) {
      halt()
      setPlaying(false)
      return
    }
    if (idx !== start) charOffset = undefined
    const seconds = chapterSeconds(manifest, b.slug, idx)!
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    savePosition(b.slug, idx)
    if (charOffset !== undefined) {
      const text = b.chapters[idx].content
      const timings = await loadTimings(b.slug, idx)
      if (gen !== genRef.current) return
      seekNarration(preparedUrl(b.slug, idx), timeForChar(text, timings, charOffset, seconds), seconds)
    }
    const fail = (err: unknown) => {
      if (gen !== genRef.current) return
      console.error('Narration failed:', err)
      halt()
      setPlaying(false)
    }
    try {
      const narration = await playNarration(b.slug, idx, rateRef.current, {
        onPlaying: () => { if (gen === genRef.current) setLoading(false) },
        onEnded: () => { if (gen === genRef.current) finishChapterRef.current(idx) },
        // Headphones unplugged, a call, another app: the browser paused it
        onPaused: () => { if (gen === genRef.current) { halt(); setPlaying(false) } },
        onError: fail,
      })
      // Halted (pause, another chapter) while loading
      if (gen !== genRef.current) {
        narration.stop()
        return
      }
      narrationRef.current = narration
      narration.setVolume(volumeRef.current)
      followNarration(gen, b, idx, narration.audio)
    } catch (err) {
      fail(err)
    }
  }, [halt, followNarration])

  /** Chapter `idx` finished: play the next one, or stop at the end of the book. */
  const finishChapter = useCallback((idx: number) => {
    const b = bookRef.current
    if (sleepTimerRef.current?.choice === 'chapter') {
      // Sleep timer: stop here and resume with the next chapter
      halt()
      setPlaying(false)
      setSleepTimer(null)
      volumeRef.current = 1
      if (b && idx + 1 < b.chapters.length) {
        setChapterIdx(idx + 1)
        chapterIdxRef.current = idx + 1
        savePosition(b.slug, idx + 1)
      }
      return
    }
    if (b && idx + 1 < b.chapters.length) {
      startPlayback(idx + 1)
    } else {
      halt()
      setPlaying(false)
    }
  }, [startPlayback, halt])
  finishChapterRef.current = finishChapter

  const updateHistory = useCallback((b: AudioBook, idx: number) => {
    setHistory(prev => {
      const filtered = prev.filter(h => h.slug !== b.slug)
      const entry: HistoryEntry = { slug: b.slug, title: b.title, author: b.author, chapterIdx: idx, timestamp: Date.now() }
      const updated = [entry, ...filtered]
      saveHistory(updated)
      return updated
    })
  }, [])

  // Keep history in sync with current playback position
  useEffect(() => {
    if (!book) return
    setHistory(prev => {
      const idx = prev.findIndex(h => h.slug === book.slug)
      if (idx === -1) return prev
      if (prev[idx].chapterIdx === chapterIdx) return prev
      const updated = [...prev]
      updated[idx] = { ...updated[idx], chapterIdx, timestamp: Date.now() }
      saveHistory(updated)
      return updated
    })
  }, [book, chapterIdx])

  const loadAndPlay = useCallback((newBook: AudioBook, startChapter?: number, charOffset?: number) => {
    // Books without narration are reading-only (books#19)
    const manifest = getLoadedManifest()
    if (!manifest || !isNarrated(manifest, newBook.slug)) return
    const track = trackRef.current
    if (charOffset !== undefined && bookRef.current?.slug === newBook.slug && track?.idx === startChapter
      && track.audio.readyState > 0 && track.timings !== undefined) {
      track.audio.currentTime = timeForChar(track.text, track.timings, charOffset, track.audio.duration)
      return
    }
    const idx = startChapter ?? loadPosition(newBook.slug)
    setBook(newBook)
    bookRef.current = newBook
    updateHistory(newBook, idx)
    startPlayback(idx, charOffset)
  }, [startPlayback, updateHistory])

  const play = useCallback(() => {
    if (bookRef.current) startPlayback(chapterIdxRef.current)
  }, [startPlayback])

  const pause = useCallback(() => {
    halt()
    setPlaying(false)
  }, [halt])

  const setChapterAndPlay = useCallback((idx: number, dir: 1 | -1 = 1) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) return
    if (playing) {
      startPlayback(idx, undefined, dir)
      return
    }
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    savePosition(b.slug, idx)
  }, [playing, startPlayback])

  const nextChapter = useCallback(() => {
    setChapterAndPlay(chapterIdxRef.current + 1)
  }, [setChapterAndPlay])

  const prevChapter = useCallback(() => {
    setChapterAndPlay(chapterIdxRef.current - 1, -1)
  }, [setChapterAndPlay])

  /** The current chapter's audio URL and length in seconds, when it is narrated. */
  const currentChapter = useCallback(() => {
    const b = bookRef.current
    const manifest = getLoadedManifest()
    const seconds = b && manifest ? chapterSeconds(manifest, b.slug, chapterIdxRef.current) : null
    return b && seconds ? { url: preparedUrl(b.slug, chapterIdxRef.current), seconds } : null
  }, [])

  const seek = useCallback((seconds: number) => {
    const c = currentChapter()
    if (c) seekNarration(c.url, seconds, c.seconds)
  }, [currentChapter])

  const skip = useCallback((seconds: number) => {
    const c = currentChapter()
    if (c) seekNarration(c.url, getNarrationTime(c.url) + seconds, c.seconds)
  }, [currentChapter])

  const setVolume = useCallback((v: number) => {
    volumeRef.current = v
    narrationRef.current?.setVolume(v)
  }, [])

  const startSleepTimer = useCallback((choice: SleepChoice) => {
    saveSleepChoice(choice)
    setSleepTimer({ choice, remaining: choice === 'chapter' ? 0 : choice * 60_000 })
    setVolume(1)
  }, [setVolume])

  const extendSleepTimer = useCallback((minutes: number) => {
    setSleepTimer(t => t && t.choice !== 'chapter' ? { ...t, remaining: t.remaining + minutes * 60_000 } : t)
    setVolume(1)
  }, [setVolume])

  const cancelSleepTimer = useCallback(() => {
    setSleepTimer(null)
    setVolume(1)
  }, [setVolume])

  // The sleep timer counts playback time only. Ticks measure the wall clock, so
  // throttled timers on a locked screen still end it on time.
  const sleepChoice = sleepTimer?.choice
  useEffect(() => {
    if (sleepChoice === undefined || !playing) return
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const elapsed = now - last
      last = now
      const t = sleepTimerRef.current
      if (!t) return
      if (t.choice === 'chapter') {
        // finishChapter stops at the end; fade over the chapter's last seconds
        const c = currentChapter()
        if (c) {
          const leftMs = (c.seconds - getNarrationTime(c.url)) / rateRef.current * 1000
          setVolume(Math.min(1, Math.max(0, leftMs / SLEEP_FADE_MS)))
        }
        return
      }
      const remaining = t.remaining - elapsed
      if (remaining <= 0) {
        pause()
        setSleepTimer(null)
        setVolume(1)
        return
      }
      setVolume(Math.min(1, remaining / SLEEP_FADE_MS))
      // Ahead of the render: the next tick may come first
      sleepTimerRef.current = { ...t, remaining }
      setSleepTimer(sleepTimerRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [sleepChoice, playing, pause, currentChapter, setVolume])

  // Media Session API — lock screen controls + background audio metadata
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!book) {
      navigator.mediaSession.metadata = null
      return
    }
    const chapter = book.chapters[chapterIdx]
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapter?.title || book.title,
      artist: book.author,
      album: book.title,
    })
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [book, chapterIdx, playing])

  // Lock-screen buttons do exactly what the on-screen ones do. Track changes
  // from there always start playing.
  const mediaActionsRef = useRef({ play, pause, startPlayback, skip, seek })
  mediaActionsRef.current = { play, pause, startPlayback, skip, seek }
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const track = (delta: number) => {
      const b = bookRef.current
      const idx = chapterIdxRef.current + delta
      if (b && idx >= 0 && idx < b.chapters.length) mediaActionsRef.current.startPlayback(idx, undefined, delta < 0 ? -1 : 1)
    }
    ms.setActionHandler('play', () => mediaActionsRef.current.play())
    ms.setActionHandler('pause', () => mediaActionsRef.current.pause())
    ms.setActionHandler('nexttrack', () => track(1))
    ms.setActionHandler('previoustrack', () => track(-1))
    ms.setActionHandler('seekbackward', d => mediaActionsRef.current.skip(-(d.seekOffset || 15)))
    ms.setActionHandler('seekforward', d => mediaActionsRef.current.skip(d.seekOffset || 30))
    try {
      ms.setActionHandler('seekto', d => { if (d.seekTime != null) mediaActionsRef.current.seek(d.seekTime) })
    } catch { /* not supported by every browser */ }
    return () => {
      ms.setActionHandler('play', null)
      ms.setActionHandler('pause', null)
      ms.setActionHandler('nexttrack', null)
      ms.setActionHandler('previoustrack', null)
      ms.setActionHandler('seekbackward', null)
      ms.setActionHandler('seekforward', null)
      try { ms.setActionHandler('seekto', null) } catch {}
    }
  }, [])

  const setRate = useCallback((r: number) => {
    setRateState(r)
    rateRef.current = r
    saveRate(r)
    narrationRef.current?.setRate(r)
  }, [])

  return (
    <AudioPlayerContext.Provider value={{
      book, playing, loading, chapterIdx, rate, history,
      loadAndPlay, play, pause,
      setChapter: setChapterAndPlay, nextChapter, prevChapter, skip, seek,
      sleepTimer, startSleepTimer, extendSleepTimer, cancelSleepTimer,
      setRate, subscribeReadAlong, getReadAlong,
    }}>
      {children}
    </AudioPlayerContext.Provider>
  )
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext)
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider')
  return ctx
}

/** The read-along position; re-renders only the calling component when it moves. */
export function useReadAlong(): ReadAlongPosition | null {
  const { subscribeReadAlong, getReadAlong } = useAudioPlayer()
  return useSyncExternalStore(subscribeReadAlong, getReadAlong)
}
