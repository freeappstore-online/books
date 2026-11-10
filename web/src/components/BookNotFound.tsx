import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pwa } from '../fas-capabilities/pwa'
import { useOfflineBooks } from '../hooks/offlineBooks'
import { newerVersionWaiting } from '../hooks/appUpdate'

/**
 * A slug this build doesn't know may be a book added in a newer version that a
 * service worker hasn't let in yet (books#32): switch to that version and
 * reload, and say the book isn't there only when no newer version exists.
 */
export function BookNotFound() {
  const sw = import.meta.env.PROD ? navigator.serviceWorker : undefined
  const { jobs } = useOfflineBooks()
  // Reloading would cut off books being saved for offline
  const saving = Object.keys(jobs).length > 0
  const [checking, setChecking] = useState(Boolean(sw) && !saving)

  useEffect(() => {
    if (!sw || saving) {
      setChecking(false)
      return
    }
    let cancelled = false
    pwa.ready
      .then(() => sw.getRegistration())
      .then(reg => (reg ? newerVersionWaiting(reg) : false))
      .then(waiting => {
        if (cancelled) return
        if (waiting) {
          sw.addEventListener('controllerchange', () => window.location.reload(), { once: true })
          if (pwa.activate()) return
        }
        setChecking(false)
      })
    return () => { cancelled = true }
  }, [sw, saving])

  return (
    <div className="min-h-dvh bg-page text-text flex items-center justify-center">
      {checking ? (
        <p role="status" className="text-text-muted">Loading...</p>
      ) : (
        <div className="text-center space-y-4">
          <p className="text-xl text-text-muted">Book not found</p>
          <Link to="/" className="text-accent hover:underline">Browse books</Link>
        </div>
      )}
    </div>
  )
}
