import { describe, expect, it } from 'vitest'
import { appInfo } from './app.js'

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
