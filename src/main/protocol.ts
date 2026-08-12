import { app, net, protocol } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { previewCache, previewDocument, PREVIEW_ORIGIN } from './previews.js'

export const SCHEME = 'app'
export const APP_ORIGIN = `${SCHEME}://luna`

export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  `frame-src ${PREVIEW_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function previewCsp(packaged: boolean): string {
  const ancestors = packaged ? APP_ORIGIN : `${APP_ORIGIN} http://localhost:*`
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${ancestors}`,
    'sandbox allow-popups',
  ].join('; ')
}

export function previewId(url: URL): string | undefined {
  if (
    url.hostname !== 'preview' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return undefined
  }
  const match = /^\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
    url.pathname,
  )
  return match?.[1]
}

export function isRendererUrl(url: URL): boolean {
  return (
    url.protocol === `${SCHEME}:` &&
    url.hostname === 'luna' &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  )
}

export function previewResponse(html: string, packaged: boolean): Response {
  return new Response(previewDocument(html), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': previewCsp(packaged),
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

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
    const url = new URL(request.url)
    if (url.hostname === 'preview') {
      const id = previewId(url)
      const html = id === undefined ? undefined : previewCache.read(id)
      return html === undefined ? notFound() : previewResponse(html, app.isPackaged)
    }
    if (!isRendererUrl(url)) return notFound()

    const { pathname } = url
    const rel = pathname === '/' ? '/index.html' : pathname
    const target = normalize(join(base, rel))

    // Path traversal guard: everything served must stay under the build root.
    if (target !== base && !target.startsWith(base + sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    const res = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', APP_CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}
