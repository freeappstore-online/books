import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import {
  kokoroStreamPlay,
  getSavedKokoroVoice,
  saveKokoroVoice,
  isMobileDevice,
  getKokoroRuntimeInfo,
  subscribeKokoroRuntimeInfo,
  type KokoroRuntimeInfo,
} from './useKokoro'
import { isPrepared, loadPreparedManifest } from './preparedAudio'
import {
  loadRate, saveRate, loadVoice, saveVoice, loadEngine, saveEngine,
  loadHistory, saveHistory, loadPosition, savePosition,
  type HistoryEntry,
} from './audioStorage'
import { getTtsCode } from './useLanguage'

export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2, 2.5, 3]

export type TtsEngine = 'browser' | 'kokoro'

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
  loadAndPlay: (book: AudioBook, chapterIdx?: number) => void
  play: () => void
  pause: () => void
  stop: () => void
  toggleMute: () => void
  setChapter: (idx: number) => void
  nextChapter: () => void
  prevChapter: () => void
  setRate: (rate: number) => void
  setVoiceName: (name: string) => void
  setEngine: (engine: TtsEngine) => void
  setKokoroVoice: (voice: string) => void
  speakFromOffset: (chapterIdx: number, charOffset: number) => void
}

const AudioPlayerContext = createContext<AudioPlayerState | null>(null)

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<AudioBook | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [chapterIdx, setChapterIdx] = useState(0)
  const [wordHighlight, setWordHighlight] = useState<WordHighlight | null>(null)
  const [rate, setRateState] = useState(loadRate)
  const [voiceName, setVoiceNameState] = useState(loadVoice)
  const [engine, setEngineState] = useState<TtsEngine>(loadEngine)
  const [kokoroVoice, setKokoroVoiceState] = useState(getSavedKokoroVoice)
  const [kokoroRuntime, setKokoroRuntime] = useState<KokoroRuntimeInfo>(getKokoroRuntimeInfo)
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [kokoroGenerated, setKokoroGenerated] = useState(0)
  const [kokoroTotal, setKokoroTotal] = useState(0)
  const kokoroPlayerRef = useRef<{ stop: () => void; mute: () => void; unmute: () => void } | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)

  // Silent audio loop keeps the page alive when screen is locked on mobile.
  // Without this, the OS suspends the tab and SpeechSynthesis stops.
  const keepAliveRef = useRef<HTMLAudioElement | null>(null)

  const bookRef = useRef(book)
  const chapterIdxRef = useRef(chapterIdx)
  const rateRef = useRef(rate)
  const voiceNameRef = useRef(voiceName)
  // Generation counter: incremented on each intentional cancel so stale
  // onend/onerror callbacks from the cancelled utterance are ignored.
  const genRef = useRef(0)
  // Current char offset in the full chapter text, updated by onboundary.
  // Used to resume from the same position when voice/rate changes.
  const currentCharOffsetRef = useRef(0)
  const speakFromOffsetRef = useRef<(idx: number, charOffset: number) => void>(() => {})
  const speakKokoroRef = useRef<(idx: number) => void>(() => {})

  const engineRef = useRef(engine)
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

  const speakChapter = useCallback((idx: number) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) {
      speechSynthesis.cancel()
      setPlaying(false)
      setWordHighlight(null)
      return
    }

    // Bump generation so stale callbacks from the old utterance are ignored
    const gen = ++genRef.current
    speechSynthesis.cancel()

    const ch = b.chapters[idx]
    const utterance = new SpeechSynthesisUtterance(ch.content)
    utterance.rate = rateRef.current
    const voice = speechSynthesis.getVoices().find(v => v.name === voiceNameRef.current)
    if (voice) utterance.voice = voice

    currentCharOffsetRef.current = 0

    utterance.onboundary = (e) => {
      if (gen !== genRef.current) return
      if (e.name === 'word') {
        currentCharOffsetRef.current = e.charIndex
        setWordHighlight({ charIndex: e.charIndex, charLength: e.charLength })
      }
    }

    utterance.onend = () => {
      if (gen !== genRef.current) return // stale — we already started a new utterance
      const nextIdx = chapterIdxRef.current + 1
      const currentBook = bookRef.current
      if (currentBook && nextIdx < currentBook.chapters.length) {
        setChapterIdx(nextIdx)
        chapterIdxRef.current = nextIdx
        savePosition(currentBook.slug, nextIdx, 0)
        speakChapter(nextIdx)
      } else {
        setPlaying(false)
        setWordHighlight(null)
      }
    }

    utterance.onerror = (e) => {
      if (gen !== genRef.current) return
      if (e.error === 'interrupted' || e.error === 'canceled') return
      setPlaying(false)
      setWordHighlight(null)
    }

    setChapterIdx(idx)
    chapterIdxRef.current = idx
    setPlaying(true)
    setWordHighlight(null)
    savePosition(b.slug, idx, 0)
    speechSynthesis.speak(utterance)
  }, [])

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

  const toggleMute = useCallback(() => {
    if (muted) {
      speechSynthesis.resume()
      kokoroPlayerRef.current?.unmute()
      setMuted(false)
    } else {
      speechSynthesis.pause()
      kokoroPlayerRef.current?.mute()
      setMuted(true)
    }
  }, [muted])

  const loadAndPlay = useCallback((newBook: AudioBook, startChapter?: number) => {
    const saved = loadPosition(newBook.slug)
    const idx = startChapter ?? saved.chapterIdx
    // Continue mid-chapter when asked to play the chapter the saved position is in
    const offset = idx === saved.chapterIdx ? saved.charOffset : 0
    setBook(newBook)
    bookRef.current = newBook
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    updateHistory(newBook, idx)
    if (engineRef.current === 'kokoro') {
      speakKokoroRef.current(idx)
    } else if (offset > 0) {
      speakFromOffsetRef.current(idx, offset)
    } else {
      speakChapter(idx)
    }
  }, [speakChapter, updateHistory])

  const play = useCallback(() => {
    if (!bookRef.current) return
    if (engineRef.current === 'kokoro') {
      // speakKokoro defined later, use ref
      speakKokoroRef.current(chapterIdxRef.current)
      return
    }
    const offset = currentCharOffsetRef.current
    if (offset > 0) {
      speakFromOffsetRef.current(chapterIdxRef.current, offset)
    } else {
      speakChapter(chapterIdxRef.current)
    }
  }, [speakChapter])

  const pause = useCallback(() => {
    genRef.current++
    speechSynthesis.cancel()
    kokoroPlayerRef.current?.stop()
    kokoroPlayerRef.current = null
    setPlaying(false)
    setMuted(false)
    setKokoroLoading(false)
    setWordHighlight(null)
    if (bookRef.current) {
      savePosition(bookRef.current.slug, chapterIdxRef.current, currentCharOffsetRef.current)
    }
  }, [])

  const stop = useCallback(() => {
    genRef.current++
    speechSynthesis.cancel()
    kokoroPlayerRef.current?.stop()
    kokoroPlayerRef.current = null
    setPlaying(false)
    setKokoroLoading(false)
    setWordHighlight(null)
  }, [])

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

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    function playWithEngine(idx: number) {
      if (engineRef.current === 'kokoro') speakKokoroRef.current(idx)
      else speakChapter(idx)
    }
    navigator.mediaSession.setActionHandler('play', () => {
      if (!bookRef.current) return
      if (engineRef.current === 'kokoro') {
        speakKokoroRef.current(chapterIdxRef.current)
      } else {
        const offset = currentCharOffsetRef.current
        if (offset > 0) speakFromOffsetRef.current(chapterIdxRef.current, offset)
        else speakChapter(chapterIdxRef.current)
      }
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      genRef.current++
      speechSynthesis.cancel()
      kokoroPlayerRef.current?.stop()
      kokoroPlayerRef.current = null
      setPlaying(false)
      setKokoroLoading(false)
      setWordHighlight(null)
      if (bookRef.current) savePosition(bookRef.current.slug, chapterIdxRef.current, currentCharOffsetRef.current)
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      const b = bookRef.current
      if (b && chapterIdxRef.current < b.chapters.length - 1) {
        const next = chapterIdxRef.current + 1
        setChapterIdx(next); chapterIdxRef.current = next
        if (b) savePosition(b.slug, next, 0)
        playWithEngine(next)
      }
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (chapterIdxRef.current > 0) {
        const prev = chapterIdxRef.current - 1
        setChapterIdx(prev); chapterIdxRef.current = prev
        if (bookRef.current) savePosition(bookRef.current.slug, prev, 0)
        playWithEngine(prev)
      }
    })
    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
    }
  }, [speakChapter])

  const setChapterAndPlay = useCallback((idx: number) => {
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    currentCharOffsetRef.current = 0
    if (bookRef.current) savePosition(bookRef.current.slug, idx, 0)
    if (playing) {
      if (engineRef.current === 'kokoro') speakKokoroRef.current(idx)
      else speakChapter(idx)
    }
  }, [playing, speakChapter])

  const nextChapter = useCallback(() => {
    const b = bookRef.current
    if (b && chapterIdxRef.current < b.chapters.length - 1) {
      setChapterAndPlay(chapterIdxRef.current + 1)
    }
  }, [setChapterAndPlay])

  const prevChapter = useCallback(() => {
    if (chapterIdxRef.current > 0) {
      setChapterAndPlay(chapterIdxRef.current - 1)
    }
  }, [setChapterAndPlay])

  const speakFromOffset = useCallback((idx: number, charOffset: number) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) return

    const gen = ++genRef.current
    speechSynthesis.cancel()

    const ch = b.chapters[idx]
    const textFromOffset = ch.content.slice(charOffset)
    if (!textFromOffset.trim()) {
      // Offset past end of content — restart from beginning
      speakChapter(idx)
      return
    }
    const utterance = new SpeechSynthesisUtterance(textFromOffset)
    utterance.rate = rateRef.current
    const voice = speechSynthesis.getVoices().find(v => v.name === voiceNameRef.current)
    if (voice) utterance.voice = voice

    currentCharOffsetRef.current = charOffset

    utterance.onboundary = (e) => {
      if (gen !== genRef.current) return
      if (e.name === 'word') {
        const absoluteOffset = e.charIndex + charOffset
        currentCharOffsetRef.current = absoluteOffset
        setWordHighlight({ charIndex: absoluteOffset, charLength: e.charLength })
      }
    }

    utterance.onend = () => {
      if (gen !== genRef.current) return
      const nextIdx = idx + 1
      if (b && nextIdx < b.chapters.length) {
        setChapterIdx(nextIdx)
        chapterIdxRef.current = nextIdx
        savePosition(b.slug, nextIdx, 0)
        speakChapter(nextIdx)
      } else {
        setPlaying(false)
        setWordHighlight(null)
      }
    }

    utterance.onerror = (e) => {
      if (gen !== genRef.current) return
      if (e.error === 'interrupted' || e.error === 'canceled') return
      setPlaying(false)
      setWordHighlight(null)
    }

    setChapterIdx(idx)
    chapterIdxRef.current = idx
    setPlaying(true)
    setWordHighlight(null)
    savePosition(b.slug, idx, charOffset)
    speechSynthesis.speak(utterance)
  }, [speakChapter])
  speakFromOffsetRef.current = speakFromOffset

  const setRate = useCallback((r: number) => {
    setRateState(r)
    rateRef.current = r
    saveRate(r)
    if (playing) {
      if (engine === 'kokoro') speakKokoroRef.current(chapterIdxRef.current)
      else speakFromOffset(chapterIdxRef.current, currentCharOffsetRef.current)
    }
  }, [playing, speakFromOffset, engine])

  const setVoiceName = useCallback((name: string) => {
    setVoiceNameState(name)
    voiceNameRef.current = name
    saveVoice(name)
    // Only restart browser TTS (Kokoro uses its own voice setting)
    if (playing && engine === 'browser') speakFromOffset(chapterIdxRef.current, currentCharOffsetRef.current)
  }, [playing, speakFromOffset, engine])

  // ── Kokoro engine ──

  const stopKokoro = useCallback(() => {
    kokoroPlayerRef.current?.stop()
    kokoroPlayerRef.current = null
  }, [])

  const speakKokoro = useCallback(async (idx: number) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) return

    // Kokoro's 160MB model crashes mobile tabs: there, only prepared chapters use the AI voice
    if (isMobileDevice() && !isPrepared(await loadPreparedManifest(), b.slug, idx, kokoroVoice)) {
      console.log('[AudioPlayer] speakKokoro: mobile and chapter not prepared, falling back to browser TTS')
      speakChapter(idx)
      return
    }

    console.log('[AudioPlayer] speakKokoro: chapter=%d voice=%s content=%d chars', idx, kokoroVoice, b.chapters[idx].content.length)
    stopKokoro()
    speechSynthesis.cancel()
    const startGen = ++genRef.current
    setKokoroLoading(true)
    setPlaying(true)
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    setWordHighlight(null)
    savePosition(b.slug, idx, 0)

    try {
      console.log('[AudioPlayer] speakKokoro: calling kokoroStreamPlay...')
      const player = await kokoroStreamPlay(
        b.chapters[idx].content,
        kokoroVoice,
        rateRef.current,
        // onFirstAudio — first sentence is ready, hide loading
        () => { console.log('[AudioPlayer] speakKokoro: first audio ready'); setKokoroLoading(false) },
        // onDone — chapter finished, auto-advance
        () => {
          const nextIdx = chapterIdxRef.current + 1
          const currentBook = bookRef.current
          if (currentBook && nextIdx < currentBook.chapters.length) {
            setChapterIdx(nextIdx)
            chapterIdxRef.current = nextIdx
            savePosition(currentBook.slug, nextIdx, 0)
            speakKokoroRef.current(nextIdx)
          } else {
            setPlaying(false)
          }
        },
        // onError
        (err) => {
          console.error('Kokoro TTS failed:', err)
          setKokoroLoading(false)
          setPlaying(false)
        },
        // onProgress
        (generated, total) => {
          setKokoroGenerated(generated)
          setKokoroTotal(total)
        },
        // bookSlug + chapterIdx for IndexedDB caching
        b.slug,
        idx,
        'original',
      )
      console.log('[AudioPlayer] speakKokoro: player created, genRef=%d startGen=%d', genRef.current, startGen)
      // Race check: user pressed stop/pause while we were generating
      if (genRef.current !== startGen) {
        console.log('[AudioPlayer] speakKokoro: STALE — user stopped during load, killing player')
        player.stop()
        return
      }
      kokoroPlayerRef.current = player
    } catch (err) {
      console.error('Kokoro TTS failed:', err)
      setKokoroLoading(false)
      setPlaying(false)
    }
  }, [kokoroVoice, stopKokoro])

  speakKokoroRef.current = speakKokoro

  const setEngine = useCallback((e: TtsEngine) => {
    // Stop current playback
    if (e !== engine) {
      speechSynthesis.cancel()
      stopKokoro()
      setPlaying(false)
      setWordHighlight(null)
    }
    engineRef.current = e
    setEngineState(e)
    saveEngine(e)
  }, [engine, stopKokoro])

  const setKokoroVoiceVal = useCallback((v: string) => {
    setKokoroVoiceState(v)
    saveKokoroVoice(v)
  }, [])

  return (
    <AudioPlayerContext.Provider value={{
      book, playing, muted, chapterIdx, wordHighlight, rate, voiceName, voices, history,
      engine, kokoroLoading, kokoroGenerated, kokoroTotal, kokoroVoice, kokoroRuntime,
      loadAndPlay, play, pause, stop, toggleMute,
      setChapter: setChapterAndPlay, nextChapter, prevChapter,
      setRate, setVoiceName, setEngine, setKokoroVoice: setKokoroVoiceVal,
      speakFromOffset,
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
