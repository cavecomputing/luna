import type { WebContents } from 'electron'
import type { HtmlPreviewRef } from '../../shared/ipc.js'
import { err, ok, type Result } from '../../shared/result.js'
import { id, object } from '../parse.js'
import { previewCache, type PreviewCache } from '../previews.js'
import { handle } from './bus.js'

const watched = new WeakSet<WebContents>()

export function createPreview(
  input: unknown,
  ownerId: number,
  cache: PreviewCache,
  now?: number,
  token?: string,
): Result<HtmlPreviewRef> {
  const html = object(input)?.html
  if (typeof html !== 'string') return err('preview/invalid', 'HTML preview was invalid')
  return cache.create(ownerId, html, now, token)
}

export function releasePreview(
  input: unknown,
  ownerId: number,
  cache: PreviewCache,
): Result<undefined> {
  const previewId = id(object(input)?.id)
  if (previewId === undefined) return err('preview/invalid', 'HTML preview identity was invalid')
  cache.release(ownerId, previewId)
  return ok(undefined)
}

function watch(sender: WebContents): void {
  if (watched.has(sender)) return
  watched.add(sender)
  const ownerId = sender.id
  sender.once('destroyed', () => {
    previewCache.clearOwner(ownerId)
  })
}

export function register(): void {
  handle('preview:create', (event, req) => {
    watch(event.sender)
    return createPreview(req, event.sender.id, previewCache)
  })
  handle('preview:release', (event, req) =>
    releasePreview(req, event.sender.id, previewCache),
  )
}
