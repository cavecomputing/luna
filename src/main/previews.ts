import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { HtmlPreviewRef } from '../shared/ipc.js'
import { err, ok, type Result } from '../shared/result.js'

export const PREVIEW_ORIGIN = 'app://preview'
export const MAX_PREVIEW_BYTES = 1024 * 1024
export const MAX_OWNER_PREVIEWS = 32
export const PREVIEW_TTL_MS = 5 * 60 * 1000

type Entry = {
  html: string
  ownerId: number
  expiresAt: number
}

type Options = {
  maxBytes?: number
  maxPerOwner?: number
  ttlMs?: number
}

export class PreviewCache {
  readonly #entries = new Map<string, Entry>()
  readonly #maxBytes: number
  readonly #maxPerOwner: number
  readonly #ttlMs: number

  constructor(options: Options = {}) {
    this.#maxBytes = options.maxBytes ?? MAX_PREVIEW_BYTES
    this.#maxPerOwner = options.maxPerOwner ?? MAX_OWNER_PREVIEWS
    this.#ttlMs = options.ttlMs ?? PREVIEW_TTL_MS
  }

  create(
    ownerId: number,
    html: string,
    now = Date.now(),
    token: string = randomUUID(),
  ): Result<HtmlPreviewRef> {
    this.sweep(now)
    if (Buffer.byteLength(html, 'utf8') > this.#maxBytes) {
      return err('preview/too-large', 'HTML preview exceeded the size limit')
    }

    let owned = 0
    for (const entry of this.#entries.values()) {
      if (entry.ownerId === ownerId) owned += 1
    }
    if (owned >= this.#maxPerOwner) {
      return err('preview/limit', 'too many HTML previews are active')
    }

    this.#entries.set(token, { html, ownerId, expiresAt: now + this.#ttlMs })
    return ok({ id: token, url: `${PREVIEW_ORIGIN}/${token}` })
  }

  read(id: string, now = Date.now()): string | undefined {
    this.sweep(now)
    return this.#entries.get(id)?.html
  }

  release(ownerId: number, id: string): void {
    const entry = this.#entries.get(id)
    if (entry?.ownerId === ownerId) this.#entries.delete(id)
  }

  clearOwner(ownerId: number): void {
    for (const [id, entry] of this.#entries) {
      if (entry.ownerId === ownerId) this.#entries.delete(id)
    }
  }

  sweep(now = Date.now()): void {
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(id)
    }
  }
}

export const previewCache = new PreviewCache()
setInterval(() => {
  previewCache.sweep()
}, 60_000).unref()

export function previewDocument(html: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <base target="_blank">
    <style>
      :root { color-scheme: light dark; }
      html, body { min-height: 100%; }
      body { margin: 0; overflow-wrap: anywhere; }
      *, *::before, *::after { box-sizing: border-box; }
    </style>
  </head>
  <body>${html}</body>
</html>`
}
