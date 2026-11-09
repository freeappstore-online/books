import { useEffect, useRef, useState } from 'react'
import { pwa } from '../fas-capabilities/pwa'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useOfflineBooks } from '../hooks/offlineBooks'

/** An open app looks for a new version this often, and whenever it comes back to the foreground. */
const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * "New version available · Reload" (books#24). The SDK runtime (startPwa)
 * registers the service worker, which waits until the user agrees; this toast
 * replaces its unstyled two-step notice. Nothing reloads unless Reload is
 * pressed, so playback is never cut off by an update.
 */
export function UpdateToast() {
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const { playing } = useAudioPlayer()
  const { jobs } = useOfflineBooks()
  const saving = Object.keys(jobs).length > 0
  const registration = useRef<ServiceWorkerRegistration>(undefined)
  // The worker serving this page; another one taking over means a new version is running
  const initial = useRef(navigator.serviceWorker?.controller ?? null)

  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!import.meta.env.PROD || !sw) return
    const check = () => setReady(Boolean(registration.current?.waiting) || (initial.current !== null && sw.controller !== initial.current))
    const watch = () => {
      registration.current?.installing?.addEventListener('statechange', check)
      check()
    }
    pwa.ready.then(() => sw.getRegistration()).then(r => {
      registration.current = r
      r?.addEventListener('updatefound', watch)
      check()
    })
    sw.addEventListener('controllerchange', check)
    // Without this an app left open (or kept in the background on a phone) never sees a deploy
    const look = () => { if (document.visibilityState === 'visible') registration.current?.update().catch(() => {}) }
    document.addEventListener('visibilitychange', look)
    const id = setInterval(look, UPDATE_CHECK_MS)
    return () => {
      registration.current?.removeEventListener('updatefound', watch)
      sw.removeEventListener('controllerchange', check)
      document.removeEventListener('visibilitychange', look)
      clearInterval(id)
    }
  }, [])

  if (!ready || dismissed) return null

  function reload() {
    const sw = navigator.serviceWorker
    if (!registration.current?.waiting) {
      window.location.reload()
      return
    }
    // Activate the new worker, then load the page it serves
    sw.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    pwa.activate()
  }

  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 z-[60] w-[min(26rem,calc(100vw-2rem))] flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg"
      // Above the player bar, whatever its height; the bar's height already includes the
      // home-indicator inset, so that inset counts only without a bar
      style={{ bottom: 'calc(max(var(--player-h, 0px), env(safe-area-inset-bottom)) + 1rem)' }}
    >
      <span className="flex-1 min-w-0">
        New version available
        {playing && <span className="block text-xs text-text-dim">Reloading stops playback.</span>}
        {saving && <span className="block text-xs text-text-dim">Reload once saving has finished.</span>}
      </span>
      <button
        onClick={reload}
        disabled={saving}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-btn-text hover:bg-accent-hover disabled:opacity-40 transition"
      >
        Reload
      </button>
      <button onClick={() => setDismissed(true)} aria-label="Not now" className="shrink-0 p-1 text-text-dim hover:text-text transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
  )
}
