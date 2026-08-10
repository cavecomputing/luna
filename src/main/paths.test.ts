import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { assetRoot } from './paths.js'

describe('assetRoot', () => {
  it('resolves to the project assets folder in development', () => {
    const main = join('luna', 'out', 'main')
    expect(assetRoot(false, main, 'unused')).toBe(join('luna', 'assets'))
  })

  it('resolves inside the bundle resources when packaged', () => {
    const resources = join('Applications', 'Luna.app', 'Contents', 'Resources')
    expect(assetRoot(true, 'unused', resources)).toBe(join(resources, 'assets'))
  })

  it('ignores the main directory when packaged', () => {
    expect(assetRoot(true, join('somewhere', 'else'), 'res')).toBe(join('res', 'assets'))
  })
})
