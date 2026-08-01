import { describe, expect, it } from 'vitest'
import { assetRoot } from './paths.js'

describe('assetRoot', () => {
  it('resolves to the project assets folder in development', () => {
    expect(assetRoot(false, '/luna/out/main', '/unused')).toBe('/luna/assets')
  })

  it('resolves inside the bundle resources when packaged', () => {
    const resources = '/Applications/Luna.app/Contents/Resources'
    expect(assetRoot(true, '/unused', resources)).toBe(`${resources}/assets`)
  })

  it('ignores the main directory when packaged', () => {
    expect(assetRoot(true, '/somewhere/else', '/res')).toBe('/res/assets')
  })
})
