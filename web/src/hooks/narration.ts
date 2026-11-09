/**
 * Plays the prepared narration (books#4, #23): one chapter at a time through
 * one shared <audio> element, from the saved copy when the book is kept
 * offline (books#7), resuming each chapter where it was stopped.
 */
import { useSyncExternalStore } from 'react'
import { preparedUrl } from './preparedAudio'
import { savedResponse } from './offlineBooks'

/** Where each chapter was stopped (seconds by URL), kept across reloads. */
const POSITIONS_KEY = 'bp-prepared-positions'
function loadPositions(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(POSITIONS_KEY) || '{}') } catch { return {} }
}
function savePosition(url: string, seconds: number | null) {
  const positions = loadPositions()
  if (seconds === null || seconds < 1) delete positions[url]
  else positions[url] = seconds
  try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions)) } catch {}
}

/**
 * One audio element plays every chapter. iOS only lets an element play after
 * a user gesture has started it once, and chapters start after awaits
 * (manifest, saved copy) and on auto-advance, outside any gesture.
 */
const audio = typeof Audio !== 'undefined' ? new Audio() : null
let owner = 0
/** URL of the chapter the element is playing, null when stopped. */
let playingUrl: string | null = null

export interface NarrationPosition {
  /** Chapter last played, or seeked while stopped */
  url: string | null
  /** Whether that chapter is loaded in the element now */
  active: boolean
  time: number
  duration: number
}

let position: NarrationPosition = { url: null, active: false, time: 0, duration: 0 }
const listeners = new Set<() => void>()

function setPosition(next: NarrationPosition) {
  position = next
  for (const listener of listeners) listener()
}

function updatePosition() {
  if (!playingUrl) return
  const a = audio!
  const duration = Number.isFinite(a.duration) ? a.duration : 0
  setPosition({ url: playingUrl, active: true, time: a.currentTime, duration })
  // Lock screen, car and headphones show and scrub the chapter
  if ('mediaSession' in navigator && duration > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration, position: Math.min(a.currentTime, duration), playbackRate: a.playbackRate })
    } catch {}
  }
}

if (audio) {
  audio.addEventListener('timeupdate', () => {
    // The seek bar needs about a second of resolution; the lock screen extrapolates by itself
    if (Math.abs(audio.currentTime - position.time) >= 0.5) updatePosition()
  })
  for (const type of ['durationchange', 'seeked', 'ratechange', 'play', 'pause']) {
    audio.addEventListener(type, updatePosition)
  }
}

/** Where the narration is, for the seek bar. */
export function useNarrationPosition(): NarrationPosition {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => position,
    () => position,
  )
}

/** Seconds reached in chapter `url`: live while it plays, else where it was stopped. */
export function getNarrationTime(url: string): number {
  if (playingUrl === url) return audio!.currentTime
  return loadPositions()[url] ?? 0
}

/** Move chapter `url` to `seconds`: seeks it while it plays, else it resumes from there. */
export function seekNarration(url: string, seconds: number, duration: number) {
  const at = Math.min(Math.max(0, seconds), duration)
  if (playingUrl === url && audio!.readyState > 0) {
    audio!.currentTime = at
    return
  }
  savePosition(url, at)
  setPosition({ url, active: false, time: at, duration })
}

/** Object URL of the saved chapter the element is playing, revoked when replaced */
let objectUrl: string | null = null
function setSrc(src: string | null) {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = src?.startsWith('blob:') ? src : null
  if (src) audio!.src = src
  else audio!.removeAttribute('src')
}

/** Call synchronously inside a click handler, before any await. */
export function primeNarration() {
  if (!audio || !audio.paused) return
  audio.src = '/silence.wav'
  audio.play().catch(() => {})
}

export interface Narration {
  /** The shared element: its currentTime drives read-along. */
  audio: HTMLAudioElement
  stop: () => void
  setRate: (rate: number) => void
  /** 0..1, for the sleep timer's fade */
  setVolume: (volume: number) => void
}

export interface NarrationCallbacks {
  onPlaying: () => void
  onEnded: () => void
  onError: (err: unknown) => void
}

/** Play a narrated chapter from where it was stopped. */
export async function playNarration(slug: string, chapterIdx: number, rate: number, cb: NarrationCallbacks): Promise<Narration> {
  const url = preparedUrl(slug, chapterIdx)
  // A book saved for offline plays from this device (books#7)
  const saved = await savedResponse(url)
  const src = saved ? URL.createObjectURL(await saved.blob()) : url

  const a = audio!
  const me = ++owner
  const mine = () => owner === me
  let stopped = false
  let lastSaved = 0
  a.pause()
  playingUrl = url
  setPosition({ url, active: true, time: loadPositions()[url] ?? 0, duration: 0 })
  setSrc(src)
  a.addEventListener('loadedmetadata', () => {
    // Seeking before metadata is ignored by iOS Safari
    if (!mine()) return
    const at = loadPositions()[url] ?? 0
    if (at > 0 && at < a.duration - 1) a.currentTime = at
  }, { once: true })
  a.addEventListener('playing', () => { if (mine()) cb.onPlaying() }, { once: true })
  const onTime = () => {
    if (!mine() || Math.abs(a.currentTime - lastSaved) < 5) return
    lastSaved = a.currentTime
    savePosition(url, a.currentTime)
  }
  const onEnded = () => { if (!mine()) return; savePosition(url, null); if (!stopped) cb.onEnded() }
  const onErr = () => { if (mine() && !stopped) cb.onError(a.error) }
  a.addEventListener('timeupdate', onTime)
  a.addEventListener('ended', onEnded)
  a.addEventListener('error', onErr)
  a.playbackRate = rate
  a.defaultPlaybackRate = rate
  // A sleep timer may have faded the previous chapter
  a.volume = 1
  a.play().catch(err => { if (mine() && !stopped) cb.onError(err) })
  return {
    audio: a,
    stop() {
      stopped = true
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('error', onErr)
      if (!mine()) return
      // Before metadata currentTime is 0: keep the saved position
      if (!a.ended && a.readyState > 0) savePosition(url, a.currentTime)
      playingUrl = null
      setPosition({ ...position, active: false, time: getNarrationTime(url) })
      a.pause()
      setSrc(null)
      a.load()
    },
    setRate(r: number) {
      if (!mine()) return
      a.playbackRate = r
      a.defaultPlaybackRate = r
    },
    setVolume(v: number) { if (mine()) a.volume = v },
  }
}
