/** How long to wait for a newer version to download before saying the book isn't there. */
const UPDATE_WAIT_MS = 15_000

/**
 * Resolves true once a newer version of the app is installed and waiting.
 * Checks the server first when none is already on its way.
 */
export async function newerVersionWaiting(reg: ServiceWorkerRegistration, timeoutMs = UPDATE_WAIT_MS): Promise<boolean> {
  if (!reg.waiting && !reg.installing) await reg.update().catch(() => {})
  const installing = reg.installing
  if (installing) {
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, timeoutMs)
      const done = () => {
        if (installing.state === 'installing') return
        clearTimeout(timer)
        installing.removeEventListener('statechange', done)
        resolve()
      }
      installing.addEventListener('statechange', done)
      done()
    })
  }
  return Boolean(reg.waiting)
}
