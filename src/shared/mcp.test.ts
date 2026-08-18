import { describe, expect, it } from 'vitest'
import { isEnvName, mcpSource } from './mcp.js'

describe('isEnvName', () => {
  it('accepts the shapes servers actually document', () => {
    for (const name of ['GITHUB_TOKEN', 'PATH', '_private', 'API_KEY_2', 'a']) {
      expect(isEnvName(name)).toBe(true)
    }
  })

  it('rejects a name that could carry something else through a variable list', () => {
    for (const name of [
      '',
      '2FA',
      'HAS SPACE',
      'HAS-DASH',
      'HAS=EQUALS',
      'a\nB',
      'PATH;rm -rf /',
      'ENV$VAR',
    ]) {
      expect(isEnvName(name)).toBe(false)
    }
  })

  it('rejects a name past the bound', () => {
    expect(isEnvName('A'.repeat(128))).toBe(true)
    expect(isEnvName('A'.repeat(129))).toBe(false)
  })
})

describe('mcpSource', () => {
  /**
   * The prefix is what keeps a server from ever colliding with `builtin`, and
   * so from inheriting a grant somebody made about a different program.
   */
  it('namespaces a server away from every other kind of source', () => {
    expect(mcpSource('abc')).toBe('mcp:abc')
    expect(mcpSource('builtin')).not.toBe('builtin')
  })
})
