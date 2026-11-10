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
      const finish = () => {
        clearTimeout(timer)
        installing.removeEventListener('statechange', done)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      const done = () => {
        if (installing.state === 'installing') return
        finish()
      }
      installing.addEventListener('statechange', done)
      done()
    })
  }
  return Boolean(reg.waiting)
}

/**
 * Resolve the registration for this page at click time. A legacy reader scope can
 * differ from the SDK's root registration, whose activate() then returns false.
 * Reload only after that actual worker controls this page, or when another tab
 * already switched it. A stalled/replaced worker leaves the caller able to retry.
 */
export async function reloadWithAppUpdate(
  sw: ServiceWorkerContainer,
  reload: () => void = () => window.location.reload(),
  timeoutMs = UPDATE_WAIT_MS,
): Promise<boolean> {
  let reg: ServiceWorkerRegistration | undefined
  try { reg = await sw.getRegistration() } catch { return false }
  const target = reg?.waiting ?? (reg?.active && reg.active !== sw.controller ? reg.active : null)
  if (!target) {
    reload()
    return true
  }
  return new Promise<boolean>(resolve => {
    let settled = false
    const done = (activated: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      target.removeEventListener('statechange', check)
      sw.removeEventListener('controllerchange', check)
      if (activated) reload()
      resolve(activated)
    }
    const check = () => {
      // Activation precedes clients.claim(): reloading under the old controller
      // here can serve its stale shell and display the same toast again.
      if (sw.controller === target) done(true)
      else if (target.state === 'redundant') done(false)
    }
    const timer = setTimeout(() => { check(); done(false) }, timeoutMs)
    target.addEventListener('statechange', check)
    sw.addEventListener('controllerchange', check)
    // Listeners must be in place before posting: activation can finish immediately.
    try {
      if (target.state === 'installed') target.postMessage({ type: 'SKIP_WAITING' })
      check()
    } catch { done(false) }
  })
}
