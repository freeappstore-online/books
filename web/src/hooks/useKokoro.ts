/**
 * Kokoro TTS engine — runs in a Web Worker to avoid freezing the UI.
 * ~160MB model downloaded on first use, then cached in Cache Storage.
 * Sentence-by-sentence streaming with gapless Web Audio API scheduling.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { isPrepared, loadPreparedManifest, preparedUrl } from './preparedAudio'

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

/** Where each prepared chapter was stopped, so pause/play and rate changes resume instead of restarting. */
const preparedPositions = new Map<string, number>()

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
): Promise<{ stop: () => void; mute: () => void; unmute: () => void }> {
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
    }
  }

  // Helper: stream a prepared chapter, resuming where it was last stopped
  function playPrepared(url: string) {
    const audio = new Audio(url)
    audio.playbackRate = rate
    audio.currentTime = preparedPositions.get(url) ?? 0
    let stopped = false
    audio.addEventListener('playing', () => { onFirstAudio(); onProgress?.(1, 1) }, { once: true })
    audio.addEventListener('ended', () => { preparedPositions.delete(url); if (!stopped) onDone() })
    audio.addEventListener('error', () => { if (!stopped) onError(audio.error) })
    audio.play().catch(err => { if (!stopped) onError(err) })
    return {
      stop() {
        stopped = true
        if (!audio.ended) preparedPositions.set(url, audio.currentTime)
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      },
      mute() { audio.pause() },
      unmute() { audio.play().catch(() => {}) },
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
      log('streamPlay: PREPARED — streaming')
      return playPrepared(preparedUrl(bookSlug!, chapterIdx!, voiceId))
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
