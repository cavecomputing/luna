import { describe, expect, it } from 'vitest'
import { trustedSender } from './bus.js'

describe('trustedSender', () => {
  it('accepts the app origin', () => {
    expect(trustedSender('app://luna', true)).toBe(true)
    expect(trustedSender('app://luna/index.html', true)).toBe(true)
  })

  it('rejects a page with no URL', () => {
    expect(trustedSender(undefined, true)).toBe(false)
  })

  it('rejects foreign schemes in a packaged build', () => {
    expect(trustedSender('app://preview/12345678-1234-4123-8123-123456789abc', true)).toBe(false)
    expect(trustedSender('https://evil.example', true)).toBe(false)
    expect(trustedSender('file:///etc/passwd', true)).toBe(false)
    expect(trustedSender('http://localhost:5173', true)).toBe(false)
  })

  it('accepts the Vite dev server only while unpackaged', () => {
    expect(trustedSender('http://localhost:5173', false)).toBe(true)
    expect(trustedSender('http://localhost:5173/index.html', false)).toBe(true)
  })

  it('rejects the dev-server allowance in a packaged build', () => {
    // The production app must not treat localhost frames as trusted,
    // whatever the environment happens to say.
    expect(trustedSender('http://localhost:3000', true)).toBe(false)
  })
})
