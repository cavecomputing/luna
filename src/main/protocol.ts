import { net, protocol } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCHEME = 'app'
export const APP_ORIGIN = `${SCHEME}://luna`

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Must run before app 'ready'. Registering the scheme as standard + secure is
 * what gives the renderer a real origin, so CSP and same-origin behave normally.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ])
}

/**
 * Serves the built renderer over app:// instead of file://. file:// grants
 * broader read access and gives no usable origin for CSP.
 */
export function serveRenderer(root: string): void {
  const base = normalize(root)

  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const rel = pathname === '/' ? '/index.html' : pathname
    const target = normalize(join(base, rel))

    // Path traversal guard: everything served must stay under the build root.
    if (target !== base && !target.startsWith(base + sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    const res = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}
