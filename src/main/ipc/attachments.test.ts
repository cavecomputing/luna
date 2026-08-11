import { describe, expect, it, vi } from 'vitest'
import type { AttachmentInput } from '../../shared/ipc.js'
import type { AttachmentMeta } from '../../shared/types.js'
import {
  addAttachments,
  listAttachments,
  readAttachment,
  removeAttachment,
} from './attachments.js'

const meta: AttachmentMeta = {
  id: 'file-1',
  name: 'notes.txt',
  kind: 'text',
  mediaType: 'text/plain',
  size: 5,
}

type TestDeps = Parameters<typeof addAttachments>[1]

function deps(): TestDeps {
  return {
    add: vi.fn(() => Promise.resolve({ accepted: [meta], rejected: [] })),
    list: vi.fn(() => [meta]),
    remove: vi.fn(() => true),
    read: vi.fn(() => Promise.resolve({
      ...meta,
      kind: 'image' as const,
      mediaType: 'image/png',
      data: Uint8Array.from([1, 2]),
    })),
  }
}

const file: AttachmentInput = {
  name: 'notes.txt',
  mediaType: 'text/plain',
  data: new TextEncoder().encode('hello'),
}

describe('attachment IPC', () => {
  it('imports validated browser file bytes', async () => {
    const d = deps()
    expect(await addAttachments({ conversationId: 'chat-1', files: [file] }, d)).toEqual({
      ok: true,
      value: { accepted: [meta], rejected: [] },
    })
    expect(d.add).toHaveBeenCalledWith('chat-1', [file])
  })

  it('rejects malformed import payloads', async () => {
    expect(await addAttachments({ conversationId: '../chat', files: [file] }, deps())).toMatchObject({
      ok: false,
      code: 'attachment/invalid',
    })
    expect(await addAttachments({ conversationId: 'chat-1', files: [{ ...file, data: 'bytes' }] }, deps())).toMatchObject({
      ok: false,
      code: 'attachment/invalid',
    })
  })

  it('reports a missing conversation during import', async () => {
    const d = deps()
    vi.mocked(d.add).mockResolvedValue(null)
    expect(await addAttachments({ conversationId: 'missing', files: [file] }, d)).toMatchObject({
      ok: false,
      code: 'chat/missing',
    })
  })

  it('lists persistent draft metadata', () => {
    expect(listAttachments({ conversationId: 'chat-1' }, deps())).toEqual({ ok: true, value: [meta] })
  })

  it('removes only an existing draft', () => {
    const d = deps()
    expect(removeAttachment({ conversationId: 'chat-1', id: 'file-1' }, d)).toEqual({ ok: true, value: undefined })
    vi.mocked(d.remove).mockReturnValue(false)
    expect(removeAttachment({ conversationId: 'chat-1', id: 'file-1' }, d)).toMatchObject({ ok: false, code: 'attachment/missing' })
  })

  it('returns image bytes without exposing a path', async () => {
    expect(await readAttachment({ conversationId: 'chat-1', id: 'file-1' }, deps())).toEqual({
      ok: true,
      value: { mediaType: 'image/png', data: Uint8Array.from([1, 2]) },
    })
  })

  it('does not return non-image attachment bytes', async () => {
    const d = deps()
    vi.mocked(d.read).mockResolvedValue({ ...meta, data: Uint8Array.from([1]) })
    expect(await readAttachment({ conversationId: 'chat-1', id: 'file-1' }, d)).toMatchObject({ ok: false, code: 'attachment/not-image' })
  })
})
