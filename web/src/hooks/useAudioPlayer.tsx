import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import {
  kokoroStreamPlay,
  getSavedKokoroVoice,
  saveKokoroVoice,
  isMobileDevice,
  primePreparedAudio,
  getKokoroRuntimeInfo,
  subscribeKokoroRuntimeInfo,
  getPreparedTime,
  seekPrepared,
  type KokoroPlayback,
  type KokoroRuntimeInfo,
} from './useKokoro'
import { getLoadedManifest, isNarrated, isPrepared, loadPreparedManifest, preparedUrl } from './preparedAudio'
import {
  loadRate, saveRate, loadVoice, saveVoice, loadEngine, saveEngine,
  loadHistory, saveHistory, loadPosition, savePosition, saveSleepChoice,
  type HistoryEntry,
} from './audioStorage'
import { getTtsCode } from './useLanguage'

export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2, 2.5, 3]

export type TtsEngine = 'browser' | 'kokoro'

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

interface WordHighlight {
  charIndex: number
  charLength: number
}

interface AudioPlayerState {
  book: AudioBook | null
  playing: boolean
  muted: boolean
  chapterIdx: number
  /** Char offset reached in the chapter by device speech (to the start of the sentence chunk) */
  chapterOffset: number
  wordHighlight: WordHighlight | null
  rate: number
  voiceName: string
  voices: SpeechSynthesisVoice[]
  history: HistoryEntry[]
  engine: TtsEngine
  kokoroLoading: boolean
  kokoroGenerated: number
  kokoroTotal: number
  kokoroVoice: string
  kokoroRuntime: KokoroRuntimeInfo
  /** Play `book` from `chapterIdx` (default: saved position), at `charOffset` within it. */
  loadAndPlay: (book: AudioBook, chapterIdx?: number, charOffset?: number) => void
  play: () => void
  pause: () => void
  stop: () => void
  toggleMute: () => void
  setChapter: (idx: number) => void
  nextChapter: () => void
  prevChapter: () => void
  /** Jump `seconds` forward (or back, if negative) in the chapter */
  skip: (seconds: number) => void
  /** Move AI narration of the current chapter to `seconds` */
  seekAi: (seconds: number) => void
  sleepTimer: SleepTimer | null
  startSleepTimer: (choice: SleepChoice) => void
  /** Add minutes to a running timer */
  extendSleepTimer: (minutes: number) => void
  cancelSleepTimer: () => void
  setRate: (rate: number) => void
  setVoiceName: (name: string) => void
  setEngine: (engine: TtsEngine) => void
  setKokoroVoice: (voice: string) => void
}

const AudioPlayerContext = createContext<AudioPlayerState | null>(null)

// Chrome's network voices stop about 15 s into an utterance, so browser speech
// is fed sentence-sized pieces of about 10 s at the current rate.
const CHUNK_CHARS_AT_1X = 160

/** Split `text` from `from` into utterances, each with its start offset in `text`. */
function chunkText(text: string, from: number, rate: number): { start: number; text: string }[] {
  const max = Math.round(CHUNK_CHARS_AT_1X * Math.min(Math.max(rate, 0.5), 3))
  const chunks: { start: number; text: string }[] = []
  let i = from
  while (i < text.length) {
    let end = Math.min(text.length, i + max)
    const newline = text.indexOf('\n', i)
    if (newline !== -1 && newline < end) {
      end = newline + 1
    } else if (end < text.length) {
      const slice = text.slice(i, end)
      let cut = 0
      for (const m of slice.matchAll(/[.!?;:]["'”’)\]]*\s+/g)) cut = m.index + m[0].length
      if (cut === 0) cut = slice.lastIndexOf(', ') + 2
      if (cut <= 1) cut = slice.lastIndexOf(' ') + 1
      if (cut > 0) end = i + cut
    }
    if (text.slice(i, end).trim()) chunks.push({ start: i, text: text.slice(i, end) })
    i = end
  }
  return chunks
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<AudioBook | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [chapterIdx, setChapterIdx] = useState(0)
  const [chapterOffset, setChapterOffset] = useState(0)
  const [wordHighlight, setWordHighlight] = useState<WordHighlight | null>(null)
  const [rate, setRateState] = useState(loadRate)
  const [voiceName, setVoiceNameState] = useState(loadVoice)
  const [engine, setEngineState] = useState<TtsEngine>(loadEngine)
  const [kokoroVoice, setKokoroVoiceState] = useState(getSavedKokoroVoice)
  const [kokoroRuntime, setKokoroRuntime] = useState<KokoroRuntimeInfo>(getKokoroRuntimeInfo)
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [kokoroGenerated, setKokoroGenerated] = useState(0)
  const [kokoroTotal, setKokoroTotal] = useState(0)
  const kokoroPlayerRef = useRef<KokoroPlayback | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [sleepTimer, setSleepTimer] = useState<SleepTimer | null>(null)
  const sleepTimerRef = useRef(sleepTimer)
  sleepTimerRef.current = sleepTimer
  // Playback volume, lowered by the sleep timer's fade
  const volumeRef = useRef(1)

  // Silent audio loop keeps the page alive when screen is locked on mobile.
  // Without this, the OS suspends the tab and SpeechSynthesis stops.
  const keepAliveRef = useRef<HTMLAudioElement | null>(null)

  const bookRef = useRef(book)
  const chapterIdxRef = useRef(chapterIdx)
  const rateRef = useRef(rate)
  const voiceNameRef = useRef(voiceName)
  const engineRef = useRef(engine)
  // Generation counter: bumped whenever playback is halted, so callbacks from
  // the halted utterance or AI player are ignored.
  const genRef = useRef(0)
  // Char offset in the current chapter reached by browser speech; resumes
  // from there after pause, speed or voice changes.
  const currentCharOffsetRef = useRef(0)
  // Chrome can drop events of an utterance nothing references any more
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const mutedRef = useRef(false)
  bookRef.current = book
  chapterIdxRef.current = chapterIdx
  rateRef.current = rate
  voiceNameRef.current = voiceName
  engineRef.current = engine

  useEffect(() => {
    function load() {
      const ttsLang = getTtsCode().slice(0, 2) // e.g. 'en', 'zh', 'ru'
      const v = speechSynthesis.getVoices().filter(v => v.lang.startsWith(ttsLang))
      setVoices(v)
      if (v.length > 0 && !voiceNameRef.current) {
        const preferred = v.find(v => v.name.includes('Samantha') || v.name.includes('Google') || v.default)
        const name = preferred?.name || v[0].name
        setVoiceNameState(name)
        voiceNameRef.current = name
      }
    }
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  useEffect(() => () => {
    speechSynthesis.cancel()
    keepAliveRef.current?.pause()
    kokoroPlayerRef.current?.stop()
  }, [])

  useEffect(() => subscribeKokoroRuntimeInfo(setKokoroRuntime), [])

  // Start/stop silent audio keepalive when playing state changes
  useEffect(() => {
    if (playing) {
      if (!keepAliveRef.current) {
        const audio = new Audio('/silence.wav')
        audio.loop = true
        audio.volume = 0.01
        keepAliveRef.current = audio
      }
      keepAliveRef.current.play().catch(() => {})
    } else {
      keepAliveRef.current?.pause()
    }
  }, [playing])

  /** Silence every engine and invalidate their pending callbacks; returns the new generation. */
  const halt = useCallback(() => {
    const gen = ++genRef.current
    speechSynthesis.cancel()
    // A paused synthesizer keeps later utterances paused too
    speechSynthesis.resume()
    utteranceRef.current = null
    kokoroPlayerRef.current?.stop()
    kokoroPlayerRef.current = null
    mutedRef.current = false
    setMuted(false)
    setKokoroLoading(false)
    setWordHighlight(null)
    return gen
  }, [])

  /** Mark chapter `idx` of `b` as playing from `offset`. */
  const enterChapter = useCallback((b: AudioBook, idx: number, offset: number) => {
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    currentCharOffsetRef.current = offset
    setChapterOffset(offset)
    setPlaying(true)
    savePosition(b.slug, idx, offset)
  }, [])

  // Engine dispatch and auto-advance go through refs: the speak functions
  // below and these call each other.
  const speakKokoroRef = useRef<(idx: number) => void>(() => {})
  const speakBrowserRef = useRef<(idx: number, offset: number) => void>(() => {})

  const startPlayback = useCallback((idx: number, offset = 0) => {
    if (engineRef.current === 'kokoro') speakKokoroRef.current(idx)
    else speakBrowserRef.current(idx, offset)
  }, [])

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
        currentCharOffsetRef.current = 0
        setChapterOffset(0)
        savePosition(b.slug, idx + 1, 0)
      }
      return
    }
    if (b && idx + 1 < b.chapters.length) {
      startPlayback(idx + 1, 0)
    } else {
      setPlaying(false)
      setWordHighlight(null)
    }
  }, [startPlayback, halt])

  const speakBrowser = useCallback((idx: number, offset: number) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) return
    const text = b.chapters[idx].content
    if (offset >= text.length || !text.slice(offset).trim()) offset = 0

    const gen = halt()
    enterChapter(b, idx, offset)
    const chunks = chunkText(text, offset, rateRef.current)
    let next = 0

    function speakNext() {
      if (gen !== genRef.current) return
      const chunk = chunks[next++]
      if (!chunk) { finishChapter(idx); return }

      const utterance = new SpeechSynthesisUtterance(chunk.text)
      utterance.rate = rateRef.current
      // Without a lang, a missing voice falls back to the system default, which may not be English
      utterance.lang = getTtsCode()
      utterance.volume = volumeRef.current
      const voice = speechSynthesis.getVoices().find(v => v.name === voiceNameRef.current)
      if (voice) utterance.voice = voice

      utterance.onstart = () => {
        if (gen !== genRef.current) return
        currentCharOffsetRef.current = chunk.start
        setChapterOffset(chunk.start)
        savePosition(b!.slug, idx, chunk.start)
      }
      utterance.onboundary = (e) => {
        if (gen !== genRef.current || e.name !== 'word') return
        const charIndex = chunk.start + e.charIndex
        const charLength = e.charLength || (/^\S+/.exec(chunk.text.slice(e.charIndex))?.[0].length ?? 0)
        currentCharOffsetRef.current = charIndex
        setWordHighlight({ charIndex, charLength })
      }
      utterance.onend = speakNext
      utterance.onerror = (e) => {
        if (gen !== genRef.current) return
        if (e.error === 'interrupted' || e.error === 'canceled') return
        setPlaying(false)
        setWordHighlight(null)
      }
      utteranceRef.current = utterance
      speechSynthesis.speak(utterance)
    }
    speakNext()
  }, [halt, enterChapter, finishChapter])
  speakBrowserRef.current = speakBrowser

  const speakKokoro = useCallback(async (idx: number) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) return

    const gen = halt()
    enterChapter(b, idx, 0)
    primePreparedAudio()

    // Kokoro's 160MB model crashes mobile tabs: there, only prepared chapters use the AI voice
    if (isMobileDevice() && !isPrepared(await loadPreparedManifest(), b.slug, idx, kokoroVoice)) {
      if (gen !== genRef.current) return
      console.log('[AudioPlayer] speakKokoro: mobile and chapter not prepared, falling back to browser TTS')
      speakBrowser(idx, 0)
      return
    }
    if (gen !== genRef.current) return

    console.log('[AudioPlayer] speakKokoro: chapter=%d voice=%s content=%d chars', idx, kokoroVoice, b.chapters[idx].content.length)
    setKokoroLoading(true)
    try {
      const player = await kokoroStreamPlay(
        b.chapters[idx].content,
        kokoroVoice,
        rateRef.current,
        // onFirstAudio — first sentence is ready, hide loading
        () => { if (gen === genRef.current) setKokoroLoading(false) },
        // onDone — chapter finished, auto-advance
        () => { if (gen === genRef.current) finishChapter(idx) },
        // onError
        (err) => {
          if (gen !== genRef.current) return
          console.error('Kokoro TTS failed:', err)
          halt()
          setPlaying(false)
        },
        // onProgress
        (generated, total) => {
          if (gen !== genRef.current) return
          setKokoroGenerated(generated)
          setKokoroTotal(total)
        },
        // bookSlug + chapterIdx for IndexedDB caching
        b.slug,
        idx,
        'original',
      )
      // Halted (pause, another chapter, another engine) while loading
      if (gen !== genRef.current) {
        player.stop()
        return
      }
      kokoroPlayerRef.current = player
      player.setVolume?.(volumeRef.current)
      // Muted while it was loading
      if (mutedRef.current) player.mute()
    } catch (err) {
      if (gen !== genRef.current) return
      console.error('Kokoro TTS failed:', err)
      setKokoroLoading(false)
      setPlaying(false)
    }
  }, [kokoroVoice, halt, enterChapter, finishChapter, speakBrowser])
  speakKokoroRef.current = speakKokoro

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

  // Device speech can't be paused reliably (Android stops instead), so muting
  // it halts and unmuting speaks again from the reached offset.
  const toggleMute = useCallback(() => {
    if (!playing) return
    if (mutedRef.current) {
      if (engineRef.current === 'browser') {
        speakBrowser(chapterIdxRef.current, currentCharOffsetRef.current)
      } else {
        kokoroPlayerRef.current?.unmute()
        mutedRef.current = false
        setMuted(false)
      }
    } else {
      if (engineRef.current === 'browser') halt()
      else kokoroPlayerRef.current?.mute()
      mutedRef.current = true
      setMuted(true)
    }
  }, [playing, halt, speakBrowser])

  const loadAndPlay = useCallback((newBook: AudioBook, startChapter?: number, charOffset?: number) => {
    // Books without AI narration are reading-only (books#19)
    const manifest = getLoadedManifest()
    if (!manifest || !isNarrated(manifest, newBook.slug)) return
    const saved = loadPosition(newBook.slug)
    const idx = startChapter ?? saved.chapterIdx
    // Continue mid-chapter when asked to play the chapter the saved position is in
    const offset = charOffset ?? (idx === saved.chapterIdx ? saved.charOffset : 0)
    setBook(newBook)
    bookRef.current = newBook
    updateHistory(newBook, idx)
    startPlayback(idx, offset)
  }, [startPlayback, updateHistory])

  const play = useCallback(() => {
    if (bookRef.current) startPlayback(chapterIdxRef.current, currentCharOffsetRef.current)
  }, [startPlayback])

  const pause = useCallback(() => {
    halt()
    setPlaying(false)
    if (bookRef.current) {
      savePosition(bookRef.current.slug, chapterIdxRef.current, currentCharOffsetRef.current)
    }
  }, [halt])

  const stop = useCallback(() => {
    halt()
    setPlaying(false)
  }, [halt])

  const setChapterAndPlay = useCallback((idx: number) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) return
    if (playing) {
      startPlayback(idx, 0)
      return
    }
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    currentCharOffsetRef.current = 0
    setChapterOffset(0)
    savePosition(b.slug, idx, 0)
  }, [playing, startPlayback])

  const nextChapter = useCallback(() => {
    setChapterAndPlay(chapterIdxRef.current + 1)
  }, [setChapterAndPlay])

  const prevChapter = useCallback(() => {
    setChapterAndPlay(chapterIdxRef.current - 1)
  }, [setChapterAndPlay])

  /** AI narration of the current chapter, if it is prepared: its URL and length in seconds. */
  const preparedChapter = useCallback(() => {
    const b = bookRef.current
    const seconds = b && getLoadedManifest()?.[kokoroVoice]?.[b.slug]?.[chapterIdxRef.current]
    return b && seconds ? { url: preparedUrl(b.slug, chapterIdxRef.current, kokoroVoice), seconds } : null
  }, [kokoroVoice])

  const seekAi = useCallback((seconds: number) => {
    const prepared = preparedChapter()
    if (engineRef.current === 'kokoro' && prepared) seekPrepared(prepared.url, seconds, prepared.seconds)
  }, [preparedChapter])

  const skip = useCallback((seconds: number) => {
    const b = bookRef.current
    if (!b) return
    if (engineRef.current === 'kokoro') {
      // Only prepared narration can be seeked; generated audio is scheduled as it is made
      const prepared = preparedChapter()
      if (prepared) seekPrepared(prepared.url, getPreparedTime(prepared.url) + seconds, prepared.seconds)
      return
    }
    // Device speech: estimate the offset from the chunk size (about 10 s each), then
    // start from the beginning of the sentence chunk it falls in
    const idx = chapterIdxRef.current
    const text = b.chapters[idx].content
    const target = currentCharOffsetRef.current + seconds * (CHUNK_CHARS_AT_1X / 10) * rateRef.current
    if (target >= text.length) {
      if (idx + 1 < b.chapters.length) setChapterAndPlay(idx + 1)
      return
    }
    const chunk = chunkText(text, 0, rateRef.current).findLast(c => c.start <= target)
    const offset = chunk?.start ?? 0
    if (playing) {
      speakBrowser(idx, offset)
      return
    }
    currentCharOffsetRef.current = offset
    setChapterOffset(offset)
    savePosition(b.slug, idx, offset)
  }, [preparedChapter, setChapterAndPlay, playing, speakBrowser])

  const setVolume = useCallback((v: number) => {
    volumeRef.current = v
    kokoroPlayerRef.current?.setVolume?.(v)
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
        // finishChapter stops at the end; fade AI narration over its last seconds
        const prepared = engineRef.current === 'kokoro' ? preparedChapter() : null
        if (prepared) {
          const leftMs = (prepared.seconds - getPreparedTime(prepared.url)) / rateRef.current * 1000
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
  }, [sleepChoice, playing, pause, preparedChapter, setVolume])

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
  const mediaActionsRef = useRef({ play, pause, startPlayback, skip, seekAi })
  mediaActionsRef.current = { play, pause, startPlayback, skip, seekAi }
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const skip = (delta: number) => {
      const b = bookRef.current
      const idx = chapterIdxRef.current + delta
      if (b && idx >= 0 && idx < b.chapters.length) mediaActionsRef.current.startPlayback(idx, 0)
    }
    ms.setActionHandler('play', () => mediaActionsRef.current.play())
    ms.setActionHandler('pause', () => mediaActionsRef.current.pause())
    ms.setActionHandler('nexttrack', () => skip(1))
    ms.setActionHandler('previoustrack', () => skip(-1))
    ms.setActionHandler('seekbackward', d => mediaActionsRef.current.skip(-(d.seekOffset || 15)))
    ms.setActionHandler('seekforward', d => mediaActionsRef.current.skip(d.seekOffset || 30))
    try {
      ms.setActionHandler('seekto', d => { if (d.seekTime != null) mediaActionsRef.current.seekAi(d.seekTime) })
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
    if (!playing) return
    // AI narration changes speed in place; device speech has to speak again at the new rate
    const kokoroPlayer = kokoroPlayerRef.current
    if (engineRef.current === 'kokoro' && kokoroPlayer?.setRate) kokoroPlayer.setRate(r)
    else startPlayback(chapterIdxRef.current, currentCharOffsetRef.current)
  }, [playing, startPlayback])

  const setVoiceName = useCallback((name: string) => {
    setVoiceNameState(name)
    voiceNameRef.current = name
    saveVoice(name)
    // Only restart browser TTS (Kokoro uses its own voice setting)
    if (playing && engineRef.current === 'browser') speakBrowser(chapterIdxRef.current, currentCharOffsetRef.current)
  }, [playing, speakBrowser])

  const setEngine = useCallback((e: TtsEngine) => {
    if (e !== engineRef.current) {
      halt()
      setPlaying(false)
    }
    engineRef.current = e
    setEngineState(e)
    saveEngine(e)
  }, [halt])

  const setKokoroVoiceVal = useCallback((v: string) => {
    setKokoroVoiceState(v)
    saveKokoroVoice(v)
  }, [])

  return (
    <AudioPlayerContext.Provider value={{
      book, playing, muted, chapterIdx, chapterOffset, wordHighlight, rate, voiceName, voices, history,
      engine, kokoroLoading, kokoroGenerated, kokoroTotal, kokoroVoice, kokoroRuntime,
      loadAndPlay, play, pause, stop, toggleMute,
      setChapter: setChapterAndPlay, nextChapter, prevChapter, skip, seekAi,
      sleepTimer, startSleepTimer, extendSleepTimer, cancelSleepTimer,
      setRate, setVoiceName, setEngine, setKokoroVoice: setKokoroVoiceVal,
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
