import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { appInfo, windowAction } from './app.js'

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
