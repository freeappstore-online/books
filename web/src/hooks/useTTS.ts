import { useState, useEffect, useRef, useCallback } from 'react'
import { kokoroStreamPlay, getSavedKokoroVoice, saveKokoroVoice, isMobileDevice } from './useKokoro'

export type TtsEngine = 'browser' | 'kokoro'

const RATE_KEY = 'freebooks-tts-rate'
const VOICE_KEY = 'freebooks-tts-voice'
const ENGINE_KEY = 'freebooks-tts-engine'

function loadEngine(): TtsEngine {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'kokoro' && !isMobileDevice() ? 'kokoro' : 'browser'
  } catch { return 'browser' }
}

export function useTTS(paragraphs: string[], initialParagraph = 0) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [rate, setRate] = useState(() => parseFloat(localStorage.getItem(RATE_KEY) || '') || 1)
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [engine, setEngine] = useState<TtsEngine>(loadEngine)
  const [kokoroVoice, setKokoroVoice] = useState(getSavedKokoroVoice)
  const [currentParagraph, setCurrentParagraph] = useState(initialParagraph)

  const paragraphsRef = useRef(paragraphs)
  paragraphsRef.current = paragraphs
  // Read at start time, and written directly by the change handlers, so a restart
  // mid-playback picks up the new setting rather than a stale closure.
  const settingsRef = useRef({ rate, voice, engine, kokoroVoice })
  settingsRef.current = { rate, voice, engine, kokoroVoice }
  // Bumped on every halt so callbacks from an earlier run are ignored.
  const runRef = useRef(0)
  const kokoroRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    const loadVoices = () => {
      const available = speechSynthesis.getVoices()
      if (available.length > 0) {
        setVoices(available)
        const savedVoiceName = localStorage.getItem(VOICE_KEY)
        const savedVoice = savedVoiceName
          ? available.find(v => v.name === savedVoiceName)
          : null
        const defaultVoice = savedVoice || available.find(v => v.lang.startsWith('en')) || available[0]
        setVoice(defaultVoice)
      }
    }
    loadVoices()
    speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices)
  }, [])

  const halt = useCallback(() => {
    runRef.current++
    speechSynthesis.cancel()
    kokoroRef.current?.stop()
    kokoroRef.current = null
  }, [])

  const start = useCallback((index: number) => {
    halt()
    const run = runRef.current
    const live = () => run === runRef.current
    const end = () => { if (live()) setIsPlaying(false) }
    setIsPlaying(true)
    setCurrentParagraph(index)
    const { rate, voice, engine, kokoroVoice } = settingsRef.current

    if (engine === 'kokoro') {
      kokoroStreamPlay(
        paragraphsRef.current, index, kokoroVoice, rate,
        i => { if (live()) setCurrentParagraph(i) },
        end,
        err => { console.error('[Kokoro]', err); end() },
      )
        .then(h => { if (live()) kokoroRef.current = h; else h.stop() })
        .catch(err => { console.error('[Kokoro]', err); end() })
      return
    }

    const speak = (i: number) => {
      if (!live()) return
      const ps = paragraphsRef.current
      while (i < ps.length && !ps[i].trim()) i++
      if (i >= ps.length) { end(); return }
      setCurrentParagraph(i)
      const utterance = new SpeechSynthesisUtterance(ps[i])
      utterance.rate = rate
      if (voice) utterance.voice = voice
      utterance.onend = () => speak(i + 1)
      utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') end()
      }
      speechSynthesis.speak(utterance)
    }
    speak(index)
  }, [halt])

  const play = useCallback((fromParagraph?: number) => {
    start(fromParagraph ?? currentParagraph)
  }, [start, currentParagraph])

  const pause = useCallback(() => {
    halt()
    setIsPlaying(false)
  }, [halt])

  const toggle = useCallback(() => {
    if (isPlaying) pause()
    else play()
  }, [isPlaying, play, pause])

  const restartIfPlaying = useCallback(() => {
    if (isPlaying) start(currentParagraph)
  }, [isPlaying, start, currentParagraph])

  const changeRate = useCallback((newRate: number) => {
    setRate(newRate)
    settingsRef.current.rate = newRate
    localStorage.setItem(RATE_KEY, String(newRate))
    restartIfPlaying()
  }, [restartIfPlaying])

  const changeVoice = useCallback((newVoice: SpeechSynthesisVoice) => {
    setVoice(newVoice)
    settingsRef.current.voice = newVoice
    localStorage.setItem(VOICE_KEY, newVoice.name)
    restartIfPlaying()
  }, [restartIfPlaying])

  const changeEngine = useCallback((newEngine: TtsEngine) => {
    setEngine(newEngine)
    settingsRef.current.engine = newEngine
    localStorage.setItem(ENGINE_KEY, newEngine)
    restartIfPlaying()
  }, [restartIfPlaying])

  const changeKokoroVoice = useCallback((id: string) => {
    setKokoroVoice(id)
    settingsRef.current.kokoroVoice = id
    saveKokoroVoice(id)
    restartIfPlaying()
  }, [restartIfPlaying])

  // Cleanup on unmount
  useEffect(() => halt, [halt])

  return {
    isPlaying,
    rate,
    voice,
    voices,
    engine,
    kokoroVoice,
    currentParagraph,
    setCurrentParagraph,
    play,
    pause,
    toggle,
    stop: pause,
    changeRate,
    changeVoice,
    changeEngine,
    changeKokoroVoice,
  }
}
