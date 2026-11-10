import { readLocalRecord, writeLocal } from './localStorage'
/**
 * Plays the prepared narration (books#4, #23): one chapter at a time through
 * one shared <audio> element, from the saved copy when the book is kept
 * offline (books#7), resuming each chapter where it was stopped. From its
 * start, a chapter can be preceded by a pause and its spoken title (books#37).
 */
import { useSyncExternalStore } from 'react'
import { preparedTitleUrl, preparedUrl } from './preparedAudio'
import { savedResponse } from './offlineBooks'
import { getVolumeBoost, setVolumeBoostPref } from './usePreferences'

/** Where each chapter was stopped (seconds by URL), kept across reloads. */
const POSITIONS_KEY = 'bp-prepared-positions'
function loadPositions(): Record<string, number> {
  return Object.fromEntries(Object.entries(readLocalRecord<number>(POSITIONS_KEY))
    .filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n >= 0))
}
function savePosition(url: string, seconds: number | null) {
  const positions = loadPositions()
  if (seconds === null || seconds < 1) delete positions[url]
  else positions[url] = seconds
  writeLocal(POSITIONS_KEY, JSON.stringify(positions))
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
/**
 * Set while the pause or the spoken title before the chapter plays: the
 * element isn't on the chapter yet, so its time isn't the chapter's.
 */
let intro: { skip: () => void } | null = null

/** Silence (5 s): primes the element for iOS, and its tail is the pause between chapters. */
const SILENCE_URL = '/silence.wav'
const SILENCE_SECONDS = 5

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
  if (!playingUrl || intro) return
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

/** Whether the pause or spoken title before the chapter is playing (read-along waits for the chapter). */
export function narrationIntroPlaying(): boolean {
  return intro !== null
}

/** Seconds reached in chapter `url`: live while it plays, else where it was stopped. */
export function getNarrationTime(url: string): number {
  // Before metadata currentTime is 0, not where the chapter will resume
  if (playingUrl === url && !intro && audio!.readyState > 0) return audio!.currentTime
  return loadPositions()[url] ?? 0
}

/** Move chapter `url` to `seconds`: seeks it while it plays, else it resumes from there. */
export function seekNarration(url: string, seconds: number, duration: number) {
  // Not past the last second: resuming there still plays to the end and moves on
  const at = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.5))
  if (playingUrl === url && !intro && audio!.readyState > 0) {
    audio!.currentTime = at
    return
  }
  savePosition(url, at)
  if (playingUrl === url && intro) {
    // A seek during the pause or title goes straight to the chapter, from there
    setPosition({ url, active: true, time: at, duration })
    intro.skip()
    return
  }
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

/**
 * Volume boost (books#37): the element plays through Web Audio, doubled, into
 * a limiter that keeps the peaks from clipping. Not offered on iOS: WebKit
 * suspends an AudioContext when the screen locks or the app goes to the
 * background, which would silence narration that otherwise plays on there.
 */
const BOOST_GAIN = 2
export const canBoostVolume = typeof AudioContext !== 'undefined' && typeof navigator !== 'undefined'
  && !/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
let boost: { ctx: AudioContext; gain: GainNode; limiter: DynamicsCompressorNode } | null = null
/** 0..1, lowered by the sleep timer's fade */
let volume = 1

function applyVolume() {
  if (!boost) {
    audio!.volume = volume
    return
  }
  // Through Web Audio the gain sets the level: the fade and the boost in one place
  const on = getVolumeBoost()
  audio!.volume = 1
  boost.gain.gain.value = (on ? BOOST_GAIN : 1) * volume
  boost.limiter.ratio.value = on ? 20 : 1
}

/** In a click (an AudioContext starts only in one): route the element through Web Audio when the boost is on. */
function startBoost() {
  if (!audio || !canBoostVolume || !getVolumeBoost()) return
  if (!boost) {
    // Web Audio hears cross-origin audio only when it was loaded with CORS, silence otherwise
    audio.crossOrigin = 'anonymous'
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    ctx.createMediaElementSource(audio).connect(gain).connect(limiter).connect(ctx.destination)
    boost = { ctx, gain, limiter }
  }
  if (boost.ctx.state !== 'running') boost.ctx.resume().catch(() => {})
  applyVolume()
}

/**
 * Turn the volume boost on or off, in the click. True when the chapter playing
 * must start again to be heard through Web Audio (it was loaded without CORS).
 */
export function setVolumeBoost(on: boolean): boolean {
  const routed = boost !== null
  setVolumeBoostPref(on)
  startBoost()
  if (audio) applyVolume()
  return !routed && boost !== null
}

/** Call synchronously inside a click handler, before any await. */
export function primeNarration() {
  startBoost()
  if (!audio || !audio.paused) return
  audio.src = SILENCE_URL
  audio.play().catch(() => {})
}

/** Stop the priming silence when no chapter follows it (paused while loading, end of the book). */
export function releaseNarration() {
  if (!audio || playingUrl || audio.paused) return
  audio.pause()
  setSrc(null)
  audio.load()
}

export interface Narration {
  /** The shared element: its currentTime drives read-along. */
  audio: HTMLAudioElement
  stop: () => void
  setRate: (rate: number) => void
  /** 0..1, for the sleep timer's fade */
  setVolume: (volume: number) => void
}

/** What plays before a chapter started from its beginning */
export interface NarrationIntro {
  /** Seconds of silence (between chapters) */
  pause: number
  /** Its spoken title */
  title: boolean
  /** The chapter's length, for the seek bar meanwhile */
  seconds: number
}

export interface NarrationCallbacks {
  onPlaying: () => void
  onEnded: () => void
  /** Paused by the browser or the system, not by stop() */
  onPaused: () => void
  onError: (err: unknown) => void
}

/**
 * Play a narrated chapter from where it was stopped. From its start, `before`'s
 * pause and spoken title play first in the same element. It moves on from each
 * on 'ended', as it does from chapter to chapter: no timer, which the
 * background and a locked screen throttle, is involved.
 */
export async function playNarration(
  slug: string, chapterIdx: number, rate: number, cb: NarrationCallbacks, signal?: AbortSignal,
  before: NarrationIntro = { pause: 0, title: false, seconds: 0 },
): Promise<Narration> {
  const url = preparedUrl(slug, chapterIdx)
  const a = audio!
  // Claim the element before awaiting: a later request must win even if this one's awaits finish last
  const me = ++owner
  const mine = () => owner === me
  // A book saved for offline plays from this device (books#7)
  const saved = await savedResponse(url)
  const blob = saved ? await saved.blob() : null
  const fromStart = !loadPositions()[url]
  const titleUrl = preparedTitleUrl(slug, chapterIdx)
  const savedTitle = fromStart && before.title ? await savedResponse(titleUrl) : undefined
  const titleBlob = savedTitle ? await savedTitle.blob() : null
  if (!mine() || signal?.aborted) return { audio: a, stop() {}, setRate() {}, setVolume() {} }

  /** Played before the chapter; the pause at normal speed */
  const steps: { src: () => string; atRate: boolean }[] = []
  if (fromStart && before.pause > 0) {
    // The tail of the silent file: it ends after exactly the pause
    steps.push({ src: () => `${SILENCE_URL}#t=${SILENCE_SECONDS - before.pause}`, atRate: false })
  }
  // Offline, only a saved title
  if (fromStart && before.title && (titleBlob || navigator.onLine)) {
    steps.push({ src: () => (titleBlob ? URL.createObjectURL(titleBlob) : titleUrl), atRate: true })
  }
  let step = 0
  const inIntro = () => step < steps.length
  let currentRate = rate
  const applyRate = () => {
    const r = inIntro() && !steps[step].atRate ? 1 : currentRate
    a.playbackRate = r
    a.defaultPlaybackRate = r
  }

  let stopped = false
  let started = false
  let lastSaved = 0
  const playStep = () => {
    const at = step
    if (inIntro()) {
      setSrc(steps[at].src())
    } else {
      intro = null
      setSrc(blob ? URL.createObjectURL(blob) : url)
      a.addEventListener('loadedmetadata', () => {
        // Seeking before metadata is ignored by iOS Safari
        if (!mine()) return
        const resumeAt = loadPositions()[url] ?? 0
        if (resumeAt > 0) a.currentTime = Math.min(resumeAt, Math.max(0, a.duration - 0.5))
      }, { once: true })
    }
    applyRate()
    a.play().catch(err => {
      if (!mine() || stopped || step !== at) return
      // The pause and the title are extras: the chapter plays without them
      if (at < steps.length) nextStep()
      else cb.onError(err)
    })
  }
  const nextStep = () => { step++; playStep() }

  a.pause()
  playingUrl = url
  intro = steps.length ? { skip: () => { if (mine() && inIntro()) { step = steps.length; playStep() } } } : null
  setPosition({ url, active: true, time: loadPositions()[url] ?? 0, duration: before.seconds })
  a.addEventListener('playing', () => { if (mine()) { started = true; cb.onPlaying() } }, { once: true })
  const onTime = () => {
    if (!mine() || inIntro() || Math.abs(a.currentTime - lastSaved) < 5) return
    lastSaved = a.currentTime
    savePosition(url, a.currentTime)
  }
  const onEnded = () => {
    if (!mine() || stopped) return
    if (inIntro()) return nextStep()
    savePosition(url, null)
    cb.onEnded()
  }
  const onErr = () => {
    if (!mine() || stopped) return
    if (inIntro()) nextStep()
    else cb.onError(a.error)
  }
  // A streamed file that runs out of data with no connection would wait forever (books#24)
  const onStall = () => {
    if (!mine() || stopped || navigator.onLine || a.paused || a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return
    if (inIntro()) nextStep()
    else if (!blob) cb.onError(new Error('offline'))
  }
  // Our own pause() calls happen before 'playing' or after stop(); 'pause' also precedes 'ended';
  // a source swapped while playing is playing again by the time a 'pause' for it arrives
  const onPause = () => { if (mine() && started && !stopped && !a.ended && a.paused) cb.onPaused() }
  a.addEventListener('timeupdate', onTime)
  a.addEventListener('pause', onPause)
  a.addEventListener('ended', onEnded)
  a.addEventListener('error', onErr)
  a.addEventListener('waiting', onStall)
  window.addEventListener('offline', onStall)
  // A sleep timer may have faded the previous chapter
  volume = 1
  applyVolume()
  playStep()
  return {
    audio: a,
    stop() {
      stopped = true
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('error', onErr)
      a.removeEventListener('waiting', onStall)
      window.removeEventListener('offline', onStall)
      a.removeEventListener('pause', onPause)
      if (!mine()) return
      // Before metadata currentTime is 0: keep the saved position
      if (!inIntro() && !a.ended && a.readyState > 0) savePosition(url, a.currentTime)
      intro = null
      playingUrl = null
      setPosition({ ...position, active: false, time: getNarrationTime(url) })
      a.pause()
      setSrc(null)
      a.load()
    },
    setRate(r: number) {
      if (!mine()) return
      currentRate = r
      applyRate()
    },
    setVolume(v: number) {
      if (!mine()) return
      volume = v
      applyVolume()
    },
  }
}
