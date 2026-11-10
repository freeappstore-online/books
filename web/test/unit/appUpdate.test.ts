import { describe, expect, it, vi } from 'vitest'
import { newerVersionWaiting } from '../../src/hooks/appUpdate'

/** A worker whose state can be moved on, firing statechange like the browser does. */
function worker(state: ServiceWorkerState) {
  const target = new EventTarget() as EventTarget & { state: ServiceWorkerState }
  target.state = state
  return target
}

function registration(init: { waiting?: unknown; installing?: unknown; update?: () => Promise<unknown> }) {
  return { waiting: null, installing: null, update: vi.fn(() => Promise.resolve()), ...init } as unknown as ServiceWorkerRegistration
}

describe('newerVersionWaiting (books#32)', () => {
  it('is true at once when a newer version is already waiting', async () => {
    const reg = registration({ waiting: worker('installed') })
    expect(await newerVersionWaiting(reg)).toBe(true)
    expect(reg.update).not.toHaveBeenCalled()
  })

  it('asks the server when nothing is on its way, and is false when there is no newer version', async () => {
    const reg = registration({})
    expect(await newerVersionWaiting(reg)).toBe(false)
    expect(reg.update).toHaveBeenCalledOnce()
  })

  it('is false when the check fails, e.g. offline', async () => {
    const reg = registration({ update: () => Promise.reject(new Error('offline')) })
    expect(await newerVersionWaiting(reg)).toBe(false)
  })

  it('waits for a version still downloading to finish installing', async () => {
    const installing = worker('installing')
    const reg = registration({ installing })
    const result = newerVersionWaiting(reg)
    installing.state = 'installed'
    Object.assign(reg, { waiting: installing, installing: null })
    installing.dispatchEvent(new Event('statechange'))
    expect(await result).toBe(true)
  })

  it('gives up after the timeout if the download stalls', async () => {
    vi.useFakeTimers()
    const reg = registration({ installing: worker('installing') })
    const result = newerVersionWaiting(reg, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toBe(false)
    vi.useRealTimers()
  })
})
