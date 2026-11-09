/**
 * Kokoro TTS engine — runs in a Web Worker to avoid freezing the UI.
 * ~160MB model downloaded on first use, then cached in Cache Storage.
 * Sentence-by-sentence streaming with gapless Web Audio API scheduling.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { isPrepared, loadPreparedManifest, preparedUrl } from './preparedAudio'
import { savedResponse } from './offlineBooks'

const VOICE_KEY = 'bp-kokoro-voice'
const READY_KEY = 'bp-kokoro-ready'
const BACKEND_KEY = 'bp-kokoro-backend'
const DTYPE_KEY = 'bp-kokoro-dtype'

type ProgressCallback = (pct: number) => void
let progressCallback: ProgressCallback | null = null
export function onKokoroProgress(cb: ProgressCallback | null) { progressCallback = cb }

export interface KokoroRuntimeInfo {
  backend: 'webgpu' | 'wasm' | 'unknown'
  dtype: string
}

type RuntimeListener = (info: KokoroRuntimeInfo) => void
const runtimeListeners = new Set<RuntimeListener>()
const readyListeners = new Set<() => void>()

function emitReadyChange() {
  for (const listener of readyListeners) listener()
}

function subscribeReady(listener: () => void) {
  readyListeners.add(listener)
  return () => {
    readyListeners.delete(listener)
  }
}

function getReadySnapshot(): boolean {
  return isKokoroDownloaded()
}

function setKokoroReadyFlag(ready: boolean) {
  try {
    if (ready) localStorage.setItem(READY_KEY, 'true')
    else localStorage.removeItem(READY_KEY)
  } catch {}
  emitReadyChange()
}

let runtimeInfo: KokoroRuntimeInfo = {
  backend: readStoredBackend(),
  dtype: readStoredDtype(),
}

function readStoredBackend(): KokoroRuntimeInfo['backend'] {
  try {
    const value = localStorage.getItem(BACKEND_KEY)
    if (value === 'webgpu' || value === 'wasm') return value
  } catch {}
  return 'unknown'
}

function readStoredDtype(): string {
  try { return localStorage.getItem(DTYPE_KEY) || 'unknown' } catch { return 'unknown' }
}

function emitRuntimeInfo() {
  for (const listener of runtimeListeners) listener(runtimeInfo)
}

function setRuntimeInfo(next: KokoroRuntimeInfo) {
  runtimeInfo = next
  try {
    localStorage.setItem(BACKEND_KEY, next.backend)
    localStorage.setItem(DTYPE_KEY, next.dtype)
  } catch {}
  emitRuntimeInfo()
}

export function getKokoroRuntimeInfo(): KokoroRuntimeInfo {
  return runtimeInfo
}

export function subscribeKokoroRuntimeInfo(listener: RuntimeListener) {
  runtimeListeners.add(listener)
  return () => {
    runtimeListeners.delete(listener)
  }
}

import { getCachedAudio, setCachedAudio, cacheKey, evictStaleCache } from './audioCache'

function log(msg: string, ...args: unknown[]) {
  console.log(`[Kokoro] ${msg}`, ...args)
}

export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart (Female)', lang: 'en-us', langLabel: 'English US' },
  { id: 'af_sky', label: 'Sky (Female)', lang: 'en-us', langLabel: 'English US' },
  { id: 'af_bella', label: 'Bella (Female)', lang: 'en-us', langLabel: 'English US' },
  { id: 'am_adam', label: 'Adam (Male)', lang: 'en-us', langLabel: 'English US' },
  { id: 'am_michael', label: 'Michael (Male)', lang: 'en-us', langLabel: 'English US' },
  { id: 'bf_emma', label: 'Emma (Female)', lang: 'en-gb', langLabel: 'English UK' },
  { id: 'bm_george', label: 'George (Male)', lang: 'en-gb', langLabel: 'English UK' },
  { id: 'zf_xiaobei', label: 'Xiaobei (Female)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'zf_xiaoni', label: 'Xiaoni (Female)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'zf_xiaoxiao', label: 'Xiaoxiao (Female)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'zf_xiaoyi', label: 'Xiaoyi (Female)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'zm_yunjian', label: 'Yunjian (Male)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'zm_yunxi', label: 'Yunxi (Male)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'zm_yunxia', label: 'Yunxia (Male)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'zm_yunyang', label: 'Yunyang (Male)', lang: 'zh-cn', langLabel: '中文' },
  { id: 'ff_siwis', label: 'Siwis (Female)', lang: 'fr-fr', langLabel: 'Français' },
  { id: 'jf_alpha', label: 'Alpha (Female)', lang: 'ja', langLabel: '日本語' },
  { id: 'jf_gongitsune', label: 'Gongitsune (Female)', lang: 'ja', langLabel: '日本語' },
  { id: 'jf_nezumi', label: 'Nezumi (Female)', lang: 'ja', langLabel: '日本語' },
  { id: 'jf_tebukuro', label: 'Tebukuro (Female)', lang: 'ja', langLabel: '日本語' },
  { id: 'jm_kumo', label: 'Kumo (Male)', lang: 'ja', langLabel: '日本語' },
  { id: 'ef_dora', label: 'Dora (Female)', lang: 'es', langLabel: 'Español' },
  { id: 'em_alex', label: 'Alex (Male)', lang: 'es', langLabel: 'Español' },
  { id: 'em_santa', label: 'Santa (Male)', lang: 'es', langLabel: 'Español' },
  { id: 'hf_alpha', label: 'Alpha (Female)', lang: 'hi', langLabel: 'हिन्दी' },
  { id: 'hf_beta', label: 'Beta (Female)', lang: 'hi', langLabel: 'हिन्दी' },
  { id: 'hm_omega', label: 'Omega (Male)', lang: 'hi', langLabel: 'हिन्दी' },
  { id: 'hm_psi', label: 'Psi (Male)', lang: 'hi', langLabel: 'हिन्दी' },
  { id: 'if_sara', label: 'Sara (Female)', lang: 'it', langLabel: 'Italiano' },
  { id: 'im_nicola', label: 'Nicola (Male)', lang: 'it', langLabel: 'Italiano' },
  { id: 'pf_dora', label: 'Dora (Female)', lang: 'pt-br', langLabel: 'Português' },
  { id: 'pm_alex', label: 'Alex (Male)', lang: 'pt-br', langLabel: 'Português' },
  { id: 'pm_santa', label: 'Santa (Male)', lang: 'pt-br', langLabel: 'Português' },
]

export const KOKORO_LANGUAGES = [...new Set(KOKORO_VOICES.map(v => v.langLabel))]

export function getSavedKokoroVoice(): string {
  try { return localStorage.getItem(VOICE_KEY) || 'af_heart' } catch { return 'af_heart' }
}

export function saveKokoroVoice(v: string) {
  try { localStorage.setItem(VOICE_KEY, v) } catch {}
}

export function isKokoroDownloaded(): boolean {
  try { return localStorage.getItem(READY_KEY) === 'true' } catch { return false }
}

export function useKokoroReady() {
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === READY_KEY) emitReadyChange()
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  return useSyncExternalStore(subscribeReady, getReadySnapshot, getReadySnapshot)
}

export function isMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

export async function verifyKokoroCache(): Promise<boolean> {
  try {
    const cacheNames = await caches.keys()
    const hasCache = cacheNames.some(n => n.includes('transformers'))
    if (!hasCache && isKokoroDownloaded()) {
      setKokoroReadyFlag(false)
      return false
    }
    return hasCache && isKokoroDownloaded()
  } catch { return isKokoroDownloaded() }
}

// ── Worker management ──

let worker: Worker | null = null
let workerReady = false
let workerInitPromise: Promise<void> | null = null

function getWorker(): Worker {
  if (worker) return worker
  log('Creating Web Worker...')
  worker = new Worker('/kokoro-worker.js?v=2', { type: 'module' })
  return worker
}

export function initWorker(): Promise<void> {
  if (workerReady) return Promise.resolve()
  if (workerInitPromise) return workerInitPromise

  workerInitPromise = new Promise<void>((resolve, reject) => {
    const w = getWorker()

    function onMessage(e: MessageEvent) {
      if (e.data.type === 'ready') {
        const backend = e.data.device === 'webgpu' || e.data.device === 'wasm' ? e.data.device : 'unknown'
        const dtype = typeof e.data.dtype === 'string' ? e.data.dtype : 'unknown'
        log('Worker: model ready (%s, %s)', backend, dtype)
        workerReady = true
        setKokoroReadyFlag(true)
        setRuntimeInfo({ backend, dtype })
        w.removeEventListener('message', onMessage)
        resolve()
      } else if (e.data.type === 'progress') {
        progressCallback?.(e.data.pct)
      } else if (e.data.type === 'log') {
        const level = e.data.level === 'warn' ? 'warn' : 'log'
        console[level](e.data.message)
      } else if (e.data.type === 'error' && !workerReady) {
        log('Worker: init FAILED:', e.data.error)
        workerInitPromise = null // allow retry
        w.removeEventListener('message', onMessage)
        reject(new Error(e.data.error))
      }
    }

    w.addEventListener('message', onMessage)
    log('Worker: sending init...')
    w.postMessage({ type: 'init' })
  })

  return workerInitPromise
}

export async function preloadKokoro(): Promise<void> {
  await initWorker()
}

/** Generate one sentence in the worker. Returns audio data via transfer. */
export function generateInWorker(text: string, voice: string): Promise<{ audio: Float32Array; sampleRate: number }> {
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const id = Math.random().toString(36).slice(2)

    function onMessage(e: MessageEvent) {
      if (e.data.id !== id) return
      w.removeEventListener('message', onMessage)
      if (e.data.type === 'audio') {
        resolve({ audio: e.data.audio, sampleRate: e.data.sampleRate })
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.error))
      }
    }

    w.addEventListener('message', onMessage)
    w.postMessage({ type: 'generate', id, text, voice })
  })
}

// ── Sentence splitting ──

function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?。！？]+[.!?。！？]+[\s]*/g) || [text]
  const merged: string[] = []
  let buf = ''
  for (const s of raw) {
    buf += s
    if (buf.length >= 200) {
      merged.push(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) merged.push(buf.trim())
  return merged.filter(s => s.length > 0)
}

// ── Streaming playback ──

// ── Prepared narration (Hugging Face) ──

/** Where each prepared chapter was stopped (seconds by URL), kept across reloads. */
const POSITIONS_KEY = 'bp-prepared-positions'
function loadPreparedPositions(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(POSITIONS_KEY) || '{}') } catch { return {} }
}
function savePreparedPosition(url: string, seconds: number | null) {
  const positions = loadPreparedPositions()
  if (seconds === null || seconds < 1) delete positions[url]
  else positions[url] = seconds
  try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions)) } catch {}
}

/**
 * One audio element plays every prepared chapter. iOS only lets an element
 * play after a user gesture has started it once, and chapters start after
 * awaits (manifest, caches) and on auto-advance, outside any gesture.
 */
const preparedAudio = typeof Audio !== 'undefined' ? new Audio() : null
let preparedOwner = 0
/** URL of the prepared chapter the element is playing, null when stopped. */
let preparedPlaying: string | null = null

export interface PreparedPosition {
  /** Chapter last played, or seeked while paused */
  url: string | null
  /** Whether that chapter is loaded in the element now */
  active: boolean
  time: number
  duration: number
}

let preparedPosition: PreparedPosition = { url: null, active: false, time: 0, duration: 0 }
const positionListeners = new Set<() => void>()

function setPreparedPosition(next: PreparedPosition) {
  preparedPosition = next
  for (const listener of positionListeners) listener()
}

function updatePreparedPosition() {
  const audio = preparedAudio!
  if (!preparedPlaying) return
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0
  setPreparedPosition({ url: preparedPlaying, active: true, time: audio.currentTime, duration })
  // Lock screen, car and headphones show and scrub the chapter
  if ('mediaSession' in navigator && duration > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration, position: Math.min(audio.currentTime, duration), playbackRate: audio.playbackRate })
    } catch {}
  }
}

if (preparedAudio) {
  preparedAudio.addEventListener('timeupdate', () => {
    // The seek bar needs about a second of resolution; the lock screen extrapolates by itself
    if (Math.abs(preparedAudio.currentTime - preparedPosition.time) >= 0.5) updatePreparedPosition()
  })
  for (const type of ['durationchange', 'seeked', 'ratechange', 'play', 'pause']) {
    preparedAudio.addEventListener(type, updatePreparedPosition)
  }
}

function subscribePreparedPosition(listener: () => void) {
  positionListeners.add(listener)
  return () => { positionListeners.delete(listener) }
}

/** Where the prepared narration is, for the seek bar. */
export function usePreparedPosition(): PreparedPosition {
  return useSyncExternalStore(subscribePreparedPosition, () => preparedPosition, () => preparedPosition)
}

/** Seconds reached in prepared chapter `url`: live while it plays, else where it was stopped. */
export function getPreparedTime(url: string): number {
  if (preparedPlaying === url) return preparedAudio!.currentTime
  return loadPreparedPositions()[url] ?? 0
}

/** Move prepared chapter `url` to `seconds`: seeks it while it plays, else it resumes from there. */
export function seekPrepared(url: string, seconds: number, duration: number) {
  const at = Math.min(Math.max(0, seconds), duration)
  if (preparedPlaying === url && preparedAudio!.readyState > 0) {
    preparedAudio!.currentTime = at
    return
  }
  savePreparedPosition(url, at)
  setPreparedPosition({ url, active: false, time: at, duration })
}

/** Object URL of the saved chapter the element is playing, revoked when replaced */
let preparedObjectUrl: string | null = null
function setPreparedSrc(audio: HTMLAudioElement, src: string | null) {
  if (preparedObjectUrl) URL.revokeObjectURL(preparedObjectUrl)
  preparedObjectUrl = src?.startsWith('blob:') ? src : null
  if (src) audio.src = src
  else audio.removeAttribute('src')
}

/** Call synchronously inside a click handler, before any await. */
export function primePreparedAudio() {
  if (!preparedAudio || !preparedAudio.paused) return
  preparedAudio.src = '/silence.wav'
  preparedAudio.play().catch(() => {})
}

export interface KokoroPlayback {
  stop: () => void
  mute: () => void
  unmute: () => void
  /** Change speed without restarting; absent where scheduled audio can't follow */
  setRate?: (rate: number) => void
  /** 0..1, for the sleep timer's fade; absent where it isn't supported */
  setVolume?: (volume: number) => void
}

export async function kokoroStreamPlay(
  text: string,
  voiceId: string,
  rate: number,
  onFirstAudio: () => void,
  onDone: () => void,
  onError: (err: unknown) => void,
  onProgress?: (generated: number, total: number) => void,
  bookSlug?: string,
  chapterIdx?: number,
  version: string = 'original',
): Promise<KokoroPlayback> {
  log('streamPlay: voice=%s rate=%s text=%d chars', voiceId, rate, text.length)

  // Evict old cache entries periodically
  evictStaleCache().then(n => { if (n > 0) log('cache: evicted %d stale entries', n) }).catch(() => {})

  // Check if the full chapter is already cached
  const fullCacheKey = bookSlug && chapterIdx !== undefined
    ? cacheKey(bookSlug, chapterIdx, voiceId, version) : null

  // Helper: play a pre-generated audio buffer directly
  function playBuffer(audio: Float32Array, sampleRate: number) {
    const ctx = new AudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    const buffer = ctx.createBuffer(1, audio.length, sampleRate)
    buffer.copyToChannel(audio as unknown as Float32Array<ArrayBuffer>, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(ctx.destination)
    onFirstAudio()
    onProgress?.(1, 1)
    source.start()
    let stopped = false
    source.onended = () => { if (!stopped) onDone() }
    return {
      stop() { stopped = true; try { source.stop() } catch {} ; ctx.close().catch(() => {}) },
      mute() { ctx.suspend().catch(() => {}) },
      unmute() { ctx.resume().catch(() => {}) },
      setRate(r: number) { source.playbackRate.value = r },
    }
  }

  // Helper: stream a prepared chapter (or play its saved copy), resuming where it was last stopped
  function playPrepared(url: string, src: string): KokoroPlayback {
    const audio = preparedAudio!
    const me = ++preparedOwner
    const mine = () => preparedOwner === me
    let stopped = false
    let lastSaved = 0
    audio.pause()
    preparedPlaying = url
    setPreparedPosition({ url, active: true, time: loadPreparedPositions()[url] ?? 0, duration: 0 })
    setPreparedSrc(audio, src)
    audio.addEventListener('loadedmetadata', () => {
      // Seeking before metadata is ignored by iOS Safari
      if (!mine()) return
      const at = loadPreparedPositions()[url] ?? 0
      if (at > 0 && at < audio.duration - 1) audio.currentTime = at
    }, { once: true })
    audio.addEventListener('playing', () => { if (mine()) { onFirstAudio(); onProgress?.(1, 1) } }, { once: true })
    const onTime = () => {
      if (!mine() || Math.abs(audio.currentTime - lastSaved) < 5) return
      lastSaved = audio.currentTime
      savePreparedPosition(url, audio.currentTime)
    }
    const onEnded = () => { if (!mine()) return; savePreparedPosition(url, null); if (!stopped) onDone() }
    const onErr = () => { if (mine() && !stopped) onError(audio.error) }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onErr)
    audio.playbackRate = rate
    audio.defaultPlaybackRate = rate
    // A sleep timer may have faded the previous chapter
    audio.volume = 1
    audio.play().catch(err => { if (mine() && !stopped) onError(err) })
    return {
      stop() {
        stopped = true
        audio.removeEventListener('timeupdate', onTime)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onErr)
        if (!mine()) return
        // Before metadata currentTime is 0: keep the saved position
        if (!audio.ended && audio.readyState > 0) savePreparedPosition(url, audio.currentTime)
        preparedPlaying = null
        setPreparedPosition({ ...preparedPosition, active: false, time: getPreparedTime(url) })
        audio.pause()
        setPreparedSrc(audio, null)
        audio.load()
      },
      mute() { if (mine()) audio.pause() },
      unmute() { if (mine()) audio.play().catch(() => {}) },
      setRate(r: number) {
        if (!mine()) return
        audio.playbackRate = r
        audio.defaultPlaybackRate = r
      },
      setVolume(v: number) { if (mine()) audio.volume = v },
    }
  }

  if (fullCacheKey) {
    // Check local IndexedDB cache
    const cached = await getCachedAudio(fullCacheKey)
    if (cached) {
      log('streamPlay: LOCAL CACHE HIT')
      return playBuffer(cached.audio, cached.sampleRate)
    }

    if (isPrepared(await loadPreparedManifest(), bookSlug!, chapterIdx!, voiceId)) {
      const url = preparedUrl(bookSlug!, chapterIdx!, voiceId)
      // A book saved for offline plays from this device (books#7)
      const saved = await savedResponse(url)
      log('streamPlay: PREPARED — %s', saved ? 'saved copy' : 'streaming')
      return playPrepared(url, saved ? URL.createObjectURL(await saved.blob()) : url)
    }

    log('streamPlay: CACHE MISS — generating locally')
  }

  // Ensure worker is ready
  await initWorker()

  const sentences = splitSentences(text)
  log('streamPlay: %d sentences', sentences.length)
  if (sentences.length === 0) { onDone(); return { stop() {}, mute() {}, unmute() {} } }

  let stopped = false
  const ctx = new AudioContext()

  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
  log('streamPlay: AudioContext state=%s', ctx.state)

  const sources: AudioBufferSourceNode[] = []
  const allAudioChunks: { audio: Float32Array; sampleRate: number }[] = []
  let nextStartTime = 0
  let firstPlayed = false
  let finishedCount = 0
  const totalSentences = sentences.length

  async function generateAndSchedule(idx: number) {
    if (stopped) return

    try {
      const t0 = performance.now()
      log('generate[%d/%d]: "%s..."', idx + 1, totalSentences, sentences[idx].slice(0, 40))

      // This runs in the worker — UI stays responsive
      const { audio, sampleRate } = await generateInWorker(sentences[idx], voiceId)

      const elapsed = Math.round(performance.now() - t0)
      log('generate[%d/%d]: %dms, %d samples', idx + 1, totalSentences, elapsed, audio.length)

      if (stopped) return

      // Save chunk for full-chapter cache
      allAudioChunks.push({ audio: new Float32Array(audio), sampleRate })

      const buffer = ctx.createBuffer(1, audio.length, sampleRate)
      buffer.copyToChannel(audio as unknown as Float32Array<ArrayBuffer>, 0)
      const duration = buffer.duration / rate

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = rate
      source.connect(ctx.destination)
      sources.push(source)

      if (!firstPlayed) {
        firstPlayed = true
        nextStartTime = ctx.currentTime
        log('schedule[%d]: FIRST audio at %f', idx + 1, nextStartTime)
        onFirstAudio()
      }

      source.start(nextStartTime)
      nextStartTime += duration
      onProgress?.(idx + 1, totalSentences)

      source.onended = () => {
        finishedCount++
        if (finishedCount >= totalSentences && !stopped) {
          log('streamPlay: ALL done')
          // Cache locally
          if (fullCacheKey && allAudioChunks.length === totalSentences) {
            const totalLen = allAudioChunks.reduce((s, c) => s + c.audio.length, 0)
            const merged = new Float32Array(totalLen)
            let offset = 0
            for (const chunk of allAudioChunks) {
              merged.set(chunk.audio, offset)
              offset += chunk.audio.length
            }
            const sr = allAudioChunks[0].sampleRate
            log('cache: saving %s (%d samples, %.1f MB)', fullCacheKey, totalLen, totalLen * 4 / 1024 / 1024)
            setCachedAudio(fullCacheKey, merged, sr).catch(() => {})
          }
          onDone()
        }
      }
    } catch (err) {
      log('generate[%d]: FAILED:', idx + 1, err)
      if (!stopped) {
        finishedCount++
        onError(err)
        if (finishedCount >= totalSentences) onDone()
      }
    }
  }

  // Sequential generation — each sentence scheduled at end of previous
  ;(async () => {
    for (let i = 0; i < sentences.length && !stopped; i++) {
      await generateAndSchedule(i)
    }
  })().catch(err => { if (!stopped) onError(err) })

  return {
    stop() {
      stopped = true
      for (const s of sources) { try { s.stop() } catch {} }
      sources.length = 0
      ctx.close().catch(() => {})
    },
    mute() { ctx.suspend().catch(() => {}) },
    unmute() { ctx.resume().catch(() => {}) },
  }
}
