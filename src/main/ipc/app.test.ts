import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { appInfo, modalState, windowAction } from './app.js'

const env = {
  name: 'Luna',
  version: '0.1.0',
  electron: '43.2.0',
  platform: 'darwin',
}

describe('appInfo', () => {
  it('returns the app identity as an Ok result', () => {
    const r = appInfo(env)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value).toEqual(env)
  })

  it('reports the platform it was given', () => {
    const r = appInfo({ ...env, platform: 'linux' })
    expect(r.ok && r.value.platform).toBe('linux')
  })
})

describe('windowAction', () => {
  const sender = {} as WebContents

  it('allows an action owned by a recovery window', () => {
    const run = vi.fn(() => true)

    expect(windowAction(sender, 'recover', run)).toEqual({ ok: true, value: undefined })
    expect(run).toHaveBeenCalledWith(sender)
  })

  it('rejects a normal renderer', () => {
    expect(windowAction(sender, 'close', () => false)).toMatchObject({
      ok: false,
      code: 'app/not-recovering',
    })
  })
})

describe('modalState', () => {
  const sender = {} as WebContents

  it('applies modal chrome to the main window', () => {
    const apply = vi.fn(() => true)

    expect(modalState(sender, true, apply)).toEqual({ ok: true, value: undefined })
    expect(apply).toHaveBeenCalledWith(sender, true)
  })

  it('rejects a non-boolean modal state', () => {
    expect(modalState(sender, 'open', () => true)).toMatchObject({
      ok: false,
      code: 'app/invalid-modal-state',
    })
  })

  it('rejects a renderer outside the main window', () => {
    expect(modalState(sender, true, () => false)).toMatchObject({
      ok: false,
      code: 'app/not-main-window',
    })
  })
})
