/**
 * Community narration from this browser (books#66): a signed-in listener who opts in lets this
 * device narrate chapters the edition's dataset has no audio for. The platform hands out one
 * chapter at a time from the edition's job set (audio.communitySet, filled by
 * .github/workflows/community-narration.yml) and verifies each upload before anyone hears it
 * (preparedAudio.ts plays the accepted ones). The work runs in narrator.worker.ts, only while this
 * tab is open; a chapter left unfinished goes back to the queue when its lease runs out.
 */
import { useSyncExternalStore } from 'react'
import type { FreeAppStore, GenerationJob, GenerationSubmissionStatus } from '@freeappstore/sdk'
import { EDITION } from '../data/edition'
import { readLocal, writeLocal } from './localStorage'

/** The edition's job set; without one the app offers no contribution */
export const COMMUNITY_SET = EDITION.audio.communitySet ?? null
/** The FreeAppStore Android app's Contribute page for this app: it narrates in the background */
export const ANDROID_CONTRIBUTE_URL = `freeappstore://native/contribute/${EDITION.id}`
export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** What devices declare and the job set asks for (the Android app declares the same) */
const MODELS = [{ model: 'kokoro', modelVersion: 'v1.0' }]
/** A lease is extended to at most this long after its claim (platform#783) */
const LEASE_CAP_MS = 2 * 60 * 60_000
const LEASE_MS = 15 * 60_000
/** Characters narrated per second of audio, with pauses (books#22: a chapter of 10k chars is ~11 min) */
const CHARS_PER_SECOND = 14
/** Encoder settings to try, in order: the pipeline's 40 kbps at Kokoro's rate, else what the browser's AAC encoder takes */
const ENCODERS: AudioEncoderConfig[] = [
  { codec: 'mp4a.40.2', sampleRate: 24_000, numberOfChannels: 1, bitrate: 40_000 },
  { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 1, bitrate: 40_000 },
  { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 1, bitrate: 96_000 },
]

const OPT_IN_KEY = 'bp-contribute'
export const getContributeOptIn = () => readLocal(OPT_IN_KEY) === '1'

/**
 * Why this browser can't narrate ('language': the in-browser voice speaks English only; 'browser':
 * no AAC encoder, e.g. Firefox), or the encoder settings to narrate with.
 */
export async function webSupport(): Promise<AudioEncoderConfig | 'language' | 'browser'> {
  if (EDITION.audio.engine !== 'kokoro' || !/^en\b/i.test(EDITION.language)) return 'language'
  if (typeof Worker === 'undefined' || typeof AudioEncoder === 'undefined') return 'browser'
  for (const config of ENCODERS) {
    if ((await AudioEncoder.isConfigSupported(config).catch(() => null))?.supported) return config
  }
  return 'browser'
}

let fas: Promise<FreeAppStore> | null = null
/** The platform SDK, loaded only where contributing is offered; captures a sign-in callback. */
export function getFas(): Promise<FreeAppStore> {
  return fas ??= import('@freeappstore/sdk').then(async ({ initApp }) => {
    const app = initApp({ appId: EDITION.id })
    await app.auth.init()
    return app
  })
}

export type ContributeStage =
  | { stage: 'idle' }
  | { stage: 'loading'; progress: number }
  | { stage: 'claiming' }
  | { stage: 'narrating'; key: string; progress: number }
  | { stage: 'no-work' }
  | { stage: 'error'; message: string }

export interface ContributeState {
  running: boolean
  status: ContributeStage
  /** Chapters sent from this tab */
  sent: number
  /** This listener's submissions by status (the newest 100), once loaded */
  submissions: Partial<Record<GenerationSubmissionStatus, number>> | null
}

let state: ContributeState = { running: false, status: { stage: 'idle' }, sent: 0, submissions: null }
const listeners = new Set<() => void>()
function set(next: Partial<ContributeState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export function useContribute(): ContributeState {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => state,
    () => state,
  )
}

/** Opt in (keeps the downloaded voice) or out (stops, and frees the voice's storage). */
export function setContributeOptIn(on: boolean) {
  writeLocal(OPT_IN_KEY, on ? '1' : '0')
  if (on) return
  stopContributing()
  worker?.terminate()
  worker = null
  deleteVoice()
}

/** Remove the downloaded voice (the model and voices caches) */
export function deleteVoice() {
  if (typeof caches === 'undefined') return
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.includes('transformers') || k === 'kokoro-voices').map(k => caches.delete(k))))
    .catch(() => {})
}

/** Refresh the counts of this listener's submissions. */
export async function loadSubmissions() {
  const app = await getFas()
  if (!app.auth.user) return
  const counts: ContributeState['submissions'] = {}
  for (const s of await app.generation.mySubmissions()) counts[s.status] = (counts[s.status] ?? 0) + 1
  set({ submissions: counts })
}

let worker: Worker | null = null
let controller: AbortController | null = null
let wakeLock: WakeLockSentinel | null = null
let jobs = 0

/** A job this device won't finish in time (or within the upload size): left to someone else */
class Skip extends Error {}

/** Narrate `job` in the worker; rejects on Stop, and with Skip when it can't finish within its lease. */
function narrate(job: GenerationJob, config: AudioEncoderConfig, signal: AbortSignal) {
  const text = job.input.text
  const { voice, speed = 1 } = job.params as { voice: string; speed?: number }
  // The audio would be too large to upload, or the lease can't last long enough: skip it at once
  const bytes = text.length / CHARS_PER_SECOND / speed * (config.bitrate ?? 0) / 8
  if (bytes > job.maxBytes * 0.9) return Promise.reject(new Skip())
  const capAt = job.leaseExpiresAt - LEASE_MS + LEASE_CAP_MS
  const started = Date.now()
  worker ??= new Worker(new URL('./narrator.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = ++jobs
  return new Promise<{ file: Blob; meta: { segments: unknown } }>((resolve, reject) => {
    const finish = (fn: () => void) => {
      w.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => { w.postMessage({ type: 'cancel' }); finish(() => reject(signal.reason)) }
    const onMessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.id !== undefined && msg.id !== id) return // a cancelled chapter's last word
      if (msg.type === 'loading') set({ status: { stage: 'loading', progress: msg.progress } })
      else if (msg.type === 'progress') {
        set({ status: { stage: 'narrating', key: job.key, progress: msg.done / msg.total } })
        // At this pace it would run past the lease's cap: give it back now rather than at the end
        const elapsed = Date.now() - started
        if (elapsed > 2 * 60_000 && started + elapsed * msg.total / msg.done > capAt) {
          w.postMessage({ type: 'cancel' })
          finish(() => reject(new Skip()))
        }
      } else if (msg.type === 'done') finish(() => resolve({ file: msg.file, meta: { segments: msg.segments } }))
      else if (msg.type === 'error') finish(() => reject(new Error(msg.message)))
    }
    w.addEventListener('message', onMessage)
    signal.addEventListener('abort', onAbort)
    w.postMessage({ type: 'narrate', id, text, voice, speed, config })
  })
}

/** Narrate chapters until there are none left, Stop, or an error. Keep the tab open meanwhile. */
export async function startContributing(config: AudioEncoderConfig) {
  if (state.running || !COMMUNITY_SET) return
  const app = await getFas()
  controller = new AbortController()
  const { signal } = controller
  set({ running: true, status: { stage: 'claiming' } })
  // A screen that turns off would put the tab to sleep
  wakeLock = await navigator.wakeLock?.request('screen').catch(() => null) ?? null
  try {
    while (!signal.aborted) {
      try {
        const { stopped } = await app.generation.contribute({
          setId: COMMUNITY_SET,
          models: MODELS,
          signal,
          generate: job => narrate(job, config, signal),
          onProgress: ({ stage, job }) => {
            if (stage === 'submitted') {
              set({ sent: state.sent + 1, status: { stage: 'claiming' } })
              loadSubmissions().catch(() => {})
            } else set({ status: { stage: 'narrating', key: job.key, progress: 0 } })
          },
        })
        if (stopped === 'no-work') {
          set({ status: { stage: 'no-work' } })
          break
        }
        // A lease that ran out: claim the next chapter
      } catch (err) {
        if (!(err instanceof Skip)) throw err
        // Claiming again releases this chapter; the platform never offers it to this listener again
        set({ status: { stage: 'claiming' } })
      }
    }
  } catch (err) {
    if (!signal.aborted) set({ status: { stage: 'error', message: err instanceof Error ? err.message : String(err) } })
  } finally {
    if (signal.aborted) set({ status: { stage: 'idle' } })
    set({ running: false })
    wakeLock?.release().catch(() => {})
    wakeLock = null
    controller = null
  }
}

export function stopContributing() {
  controller?.abort()
}
