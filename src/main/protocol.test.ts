import { describe, expect, it } from 'vitest'
import { APP_CSP, isRendererUrl, previewCsp, previewId, previewResponse } from './protocol.js'

const token = '12345678-1234-4123-8123-123456789abc'

describe('application protocol policy', () => {
  it('keeps inline styles out of Luna while allowing only the preview frame origin', () => {
    expect(APP_CSP).toContain("style-src 'self'")
    expect(APP_CSP).not.toContain("style-src 'self' 'unsafe-inline'")
    expect(APP_CSP).toContain('frame-src app://preview')
  })

  it('separates trusted renderer and preview hosts', () => {
    expect(isRendererUrl(new URL('app://luna/index.html'))).toBe(true)
    expect(isRendererUrl(new URL('https://luna/index.html'))).toBe(false)
    expect(isRendererUrl(new URL(`app://preview/${token}`))).toBe(false)
    expect(isRendererUrl(new URL('app://unknown/index.html'))).toBe(false)
  })
})

describe('preview protocol response', () => {
  it('accepts only an exact UUID token route', () => {
    expect(previewId(new URL(`app://preview/${token}`))).toBe(token)
    expect(previewId(new URL(`app://preview/${token}?leak=1`))).toBeUndefined()
    expect(previewId(new URL('app://preview/not-a-token'))).toBeUndefined()
    expect(previewId(new URL(`app://luna/${token}`))).toBeUndefined()
  })

  it('allows inline CSS under a restrictive response-header policy', async () => {
    const response = previewResponse('<style>p { color: red }</style><p>Hello</p>', true)
    const csp = response.headers.get('Content-Security-Policy') ?? ''

    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(csp).toContain("script-src 'none'")
    expect(csp).toContain("style-src 'unsafe-inline'")
    expect(csp).toContain('frame-ancestors app://luna')
    expect(csp).toContain('sandbox allow-popups')
    expect(await response.text()).toContain('p { color: red }')
  })

  it('allows the Vite origin as an ancestor only outside packaged builds', () => {
    expect(previewCsp(false)).toContain('http://localhost:*')
    expect(previewCsp(true)).not.toContain('http://localhost:*')
  })
})
