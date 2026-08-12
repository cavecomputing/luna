import { describe, expect, it } from 'vitest'
import { canFrameLoad } from './navigation.js'

describe('frame navigation', () => {
  it('allows the sandbox document to initialize', () => {
    expect(canFrameLoad('about:blank', false)).toBe(true)
    expect(
      canFrameLoad('app://preview/12345678-1234-4123-8123-123456789abc', false),
    ).toBe(true)
  })

  it('blocks embedded previews from navigating or loading another document', () => {
    expect(canFrameLoad('https://example.com', false)).toBe(false)
    expect(canFrameLoad('data:text/html,escaped', false)).toBe(false)
    expect(canFrameLoad('about:srcdoc', false)).toBe(false)
    expect(
      canFrameLoad('app://preview/12345678-1234-4123-8123-123456789abc?again=1', false),
    ).toBe(false)
  })

  it('leaves main-frame checks to the existing navigation guard', () => {
    expect(canFrameLoad('app://luna/index.html', true)).toBe(true)
  })
})
