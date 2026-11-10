import { describe, expect, it, vi } from 'vitest'
import { newerVersionWaiting, reloadWithAppUpdate } from '../../src/hooks/appUpdate'

/** A worker whose state can be moved on, firing statechange like the browser does. */
function worker(state: ServiceWorkerState) {
  const target = new EventTarget() as EventTarget & { state: ServiceWorkerState; postMessage: ReturnType<typeof vi.fn> }
  target.state = state
  target.postMessage = vi.fn()
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

function container(reg: ServiceWorkerRegistration) {
  const sw = new EventTarget() as unknown as ServiceWorkerContainer
  Object.assign(sw, { controller: worker('activated'), getRegistration: vi.fn(async () => reg) })
  return sw
}

describe('reloadWithAppUpdate', () => {
  it('activates the actual page registration even when the SDK root has no waiting worker', async () => {
    const waiting = worker('installed')
    const sw = container(registration({ waiting }))
    const reload = vi.fn()
    waiting.postMessage.mockImplementation(() => {
      waiting.state = 'activated'
      waiting.dispatchEvent(new Event('statechange'))
      Object.assign(sw, { controller: waiting })
      sw.dispatchEvent(new Event('controllerchange'))
    })
    expect(await reloadWithAppUpdate(sw, reload)).toBe(true)
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads once when another tab already activated the update before the click', async () => {
    const sw = container(registration({}))
    const reload = vi.fn()
    expect(await reloadWithAppUpdate(sw, reload)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits for an activation already started by another tab', async () => {
    const active = worker('activating')
    const sw = container(Object.assign(registration({}), { active }))
    const reload = vi.fn()
    const result = reloadWithAppUpdate(sw, reload)
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    expect(active.postMessage).not.toHaveBeenCalled()
    active.state = 'activated'
    active.dispatchEvent(new Event('statechange'))
    expect(reload).not.toHaveBeenCalled()
    Object.assign(sw, { controller: active })
    sw.dispatchEvent(new Event('controllerchange'))
    expect(await result).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('ignores unrelated controller changes while the intended update is still waiting', async () => {
    const waiting = worker('installed')
    const sw = container(registration({ waiting }))
    const reload = vi.fn()
    const result = reloadWithAppUpdate(sw, reload)
    await Promise.resolve()
    sw.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    waiting.state = 'activated'
    waiting.dispatchEvent(new Event('statechange'))
    expect(reload).not.toHaveBeenCalled()
    Object.assign(sw, { controller: waiting })
    sw.dispatchEvent(new Event('controllerchange'))
    expect(await result).toBe(true)
  })

  it('cleans up a stalled attempt, never reloads old content, and permits a retry', async () => {
    vi.useFakeTimers()
    try {
      const waiting = worker('installed')
      const sw = container(registration({ waiting }))
      const removeWorker = vi.spyOn(waiting, 'removeEventListener')
      const removeContainer = vi.spyOn(sw, 'removeEventListener')
      const reload = vi.fn()
      const result = reloadWithAppUpdate(sw, reload, 1000)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await result).toBe(false)
      expect(removeWorker).toHaveBeenCalledWith('statechange', expect.any(Function))
      expect(removeContainer).toHaveBeenCalledWith('controllerchange', expect.any(Function))
      sw.dispatchEvent(new Event('controllerchange'))
      expect(reload).not.toHaveBeenCalled()
      waiting.postMessage.mockImplementation(() => {
        waiting.state = 'activated'
        waiting.dispatchEvent(new Event('statechange'))
        Object.assign(sw, { controller: waiting })
        sw.dispatchEvent(new Event('controllerchange'))
      })
      expect(await reloadWithAppUpdate(sw, reload, 1000)).toBe(true)
      expect(reload).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('allows retry when posting to the waiting worker fails', async () => {
    const waiting = worker('installed')
    waiting.postMessage.mockImplementation(() => { throw new Error('worker gone') })
    const reload = vi.fn()
    expect(await reloadWithAppUpdate(container(registration({ waiting })), reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('waits for an already activated worker to claim this page before reloading', async () => {
    const active = worker('activated')
    const sw = container(Object.assign(registration({}), { active }))
    const reload = vi.fn()
    const result = reloadWithAppUpdate(sw, reload)
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    Object.assign(sw, { controller: active })
    sw.dispatchEvent(new Event('controllerchange'))
    expect(await result).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })
})
