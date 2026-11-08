/**
 * Kokoro TTS engine — runs in a Web Worker to avoid freezing the UI.
 * ~160MB model downloaded on first use, then cached by the browser.
 * Sentence-by-sentence streaming with gapless Web Audio API scheduling.
 *
 * Ported from bepublished (bepublished-online/platform web/src/hooks/useKokoro.ts).
 * Not ported: the IndexedDB chapter cache and Firebase crowd-sourced audio.
 */

import { useEffect, useSyncExternalStore } from 'react'

const VOICE_KEY = 'freebooks-kokoro-voice'
const READY_KEY = 'freebooks-kokoro-ready'

type ProgressCallback = (pct: number) => void
let progressCallback: ProgressCallback | null = null
export function onKokoroProgress(cb: ProgressCallback | null) { progressCallback = cb }

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

function setKokoroReadyFlag(ready: boolean) {
  try {
    if (ready) localStorage.setItem(READY_KEY, 'true')
    else localStorage.removeItem(READY_KEY)
  } catch {}
  emitReadyChange()
}

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

  return useSyncExternalStore(subscribeReady, isKokoroDownloaded, isKokoroDownloaded)
}

export function isMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

// ── Worker management ──

let worker: Worker | null = null
let workerReady = false
let workerInitPromise: Promise<void> | null = null

function getWorker(): Worker {
  if (worker) return worker
  log('Creating Web Worker...')
  worker = new Worker('/kokoro-worker.js?v=3', { type: 'module' })
  return worker
}

export function initWorker(): Promise<void> {
  if (workerReady) return Promise.resolve()
  if (workerInitPromise) return workerInitPromise

  workerInitPromise = new Promise<void>((resolve, reject) => {
    const w = getWorker()

    function onMessage(e: MessageEvent) {
      if (e.data.type === 'ready') {
        log('Worker: model ready (%s, %s)', e.data.device, e.data.dtype)
        workerReady = true
        setKokoroReadyFlag(true)
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
function generateInWorker(text: string, voice: string, speed: number): Promise<{ audio: Float32Array; sampleRate: number }> {
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
    w.postMessage({ type: 'generate', id, text, voice, speed })
  })
}

// ── Sentence splitting ──

function splitSentences(text: string): string[] {
  // `|$` keeps a trailing fragment that has no closing punctuation.
  const raw = text.match(/[^.!?。！？]+(?:[.!?。！？]+|$)\s*/g) || [text]
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

/**
 * Read `paragraphs` aloud from `startParagraph` to the end. Generation runs ahead of
 * playback in the worker; `onParagraph` fires as each paragraph starts sounding.
 */
export async function kokoroStreamPlay(
  paragraphs: string[],
  startParagraph: number,
  voiceId: string,
  speed: number,
  onParagraph: (idx: number) => void,
  onDone: () => void,
  onError: (err: unknown) => void,
): Promise<{ stop: () => void }> {
  // Create the AudioContext before any await so it is tied to the Play click.
  const ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})

  let stopped = false
  const sources: AudioBufferSourceNode[] = []
  const timers: number[] = []
  const handle = {
    stop() {
      stopped = true
      for (const t of timers) clearTimeout(t)
      for (const s of sources) { try { s.stop() } catch {} }
      sources.length = 0
      ctx.close().catch(() => {})
    },
  }

  try {
    await initWorker()
  } catch (err) {
    handle.stop()
    throw err
  }

  const chunks = paragraphs.slice(startParagraph).flatMap((p, i) =>
    splitSentences(p).map((text, j) => ({ text, paragraph: startParagraph + i, first: j === 0 })),
  )
  log('streamPlay: voice=%s speed=%s, %d chunks', voiceId, speed, chunks.length)
  if (chunks.length === 0) { handle.stop(); onDone(); return handle }

  let nextStartTime = 0

  ;(async () => {
    for (let idx = 0; idx < chunks.length && !stopped; idx++) {
      const chunk = chunks[idx]
      const t0 = performance.now()
      const { audio, sampleRate } = await generateInWorker(chunk.text, voiceId, speed)
      if (stopped) return
      log('generate[%d/%d]: %dms, %d samples', idx + 1, chunks.length, Math.round(performance.now() - t0), audio.length)

      const buffer = ctx.createBuffer(1, audio.length, sampleRate)
      buffer.copyToChannel(audio as unknown as Float32Array<ArrayBuffer>, 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      sources.push(source)

      // If generation fell behind playback, start now instead of in the past.
      const startAt = Math.max(nextStartTime, ctx.currentTime)
      source.start(startAt)
      nextStartTime = startAt + buffer.duration

      if (chunk.first) {
        timers.push(window.setTimeout(() => { if (!stopped) onParagraph(chunk.paragraph) },
          (startAt - ctx.currentTime) * 1000))
      }
      if (idx === chunks.length - 1) {
        source.onended = () => {
          if (stopped) return
          handle.stop()
          onDone()
        }
      }
    }
  })().catch(err => { if (!stopped) { handle.stop(); onError(err) } })

  return handle
}
