/**
 * Community narration from this browser (books#66): a signed-in listener who opts in lets this
 * device narrate chapters the edition's dataset has no audio for. The platform hands out one
 * chapter at a time from the edition's job set (audio.communitySet, filled by
 * .github/workflows/community-narration.yml) and verifies each upload before anyone hears it
 * (preparedAudio.ts plays the accepted ones). The work runs in narrator.worker.ts with the platform's
 * shared Kokoro runner (@freeappstore/sdk/generation-kokoro, platform#795), only while this tab is
 * open; a chapter left unfinished goes back to the queue when its lease runs out.
 */
import { useSyncExternalStore } from 'react'
import type { FreeAppStore, GenerationSubmissionStatus } from '@freeappstore/sdk'
import {
  contributeKokoro, deleteKokoroModel, kokoroDevice, kokoroEncoder, KokoroRunner,
} from '@freeappstore/sdk/generation-kokoro'
import { EDITION } from '../data/edition'
import { readLocal, writeLocal } from './localStorage'

/** The edition's job set; without one the app offers no contribution */
export const COMMUNITY_SET = EDITION.audio.communitySet ?? null
/** The FreeAppStore Android app's Contribute page for this app: it narrates in the background */
export const ANDROID_CONTRIBUTE_URL = `freeappstore://native/contribute/${EDITION.id}`
export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

const OPT_IN_KEY = 'bp-contribute'
export const getContributeOptIn = () => readLocal(OPT_IN_KEY) === '1'

/**
 * Why this browser can't narrate ('language': the in-browser voice speaks English only; 'browser':
 * no AAC encoder, e.g. Firefox), or the encoder settings to narrate with.
 */
export async function webSupport(): Promise<AudioEncoderConfig | 'language' | 'browser'> {
  if (EDITION.audio.engine !== 'kokoro' || !/^en\b/i.test(EDITION.language)) return 'language'
  return (await kokoroEncoder()) ?? 'browser'
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
  runner?.dispose()
  runner = null
  deleteVoice()
}

/** Remove the downloaded voice (the model and voices caches) */
export function deleteVoice() {
  deleteKokoroModel().catch(() => {})
}

/** Refresh the counts of this listener's submissions. */
export async function loadSubmissions() {
  const app = await getFas()
  if (!app.auth.user) return
  const counts: ContributeState['submissions'] = {}
  for (const s of await app.generation.mySubmissions()) counts[s.status] = (counts[s.status] ?? 0) + 1
  set({ submissions: counts })
}

let runner: KokoroRunner | null = null
let controller: AbortController | null = null
let wakeLock: WakeLockSentinel | null = null

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
    runner ??= new KokoroRunner({
      createWorker: () => new Worker(new URL('./narrator.worker.ts', import.meta.url), { type: 'module' }),
      encoder: config,
      device: await kokoroDevice(),
    })
    // A chapter this device can't narrate exactly or in time is skipped: the next claim releases it,
    // and the platform never offers it to this listener again
    const { stopped } = await contributeKokoro(app.generation, {
      runner,
      setId: COMMUNITY_SET,
      signal,
      onEvent: e => {
        if (e.type === 'loading') set({ status: { stage: 'loading', progress: e.progress } })
        else if (e.type === 'claimed') set({ status: { stage: 'narrating', key: e.job.key, progress: 0 } })
        else if (e.type === 'progress') {
          set({ status: { stage: 'narrating', key: e.job.key, progress: e.progress.sentence / e.progress.sentences } })
        } else if (e.type === 'submitted') {
          set({ sent: state.sent + 1, status: { stage: 'claiming' } })
          loadSubmissions().catch(() => {})
        } else set({ status: { stage: 'claiming' } })
      },
    })
    if (stopped === 'no-work') set({ status: { stage: 'no-work' } })
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
