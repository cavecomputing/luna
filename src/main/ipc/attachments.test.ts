import { describe, expect, it, vi } from 'vitest'
import type { AttachmentInput, AttachmentStorage } from '../../shared/ipc.js'
import type { AttachmentMeta } from '../../shared/types.js'
import {
  addAttachments,
  clearUnsent,
  getStorage,
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

const storage: AttachmentStorage = {
  totalBytes: 15,
  totalCount: 2,
  sentBytes: 10,
  sentCount: 1,
  unsentBytes: 5,
  unsentCount: 1,
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
    storage: vi.fn(() => Promise.resolve(storage)),
    clearUnsent: vi.fn(() => Promise.resolve({
      conversationIds: ['chat-1'],
      removedBytes: 5,
      removedCount: 1,
    })),
    confirmClear: vi.fn(() => Promise.resolve(true)),
    notifyDrafts: vi.fn(),
    notifyStorage: vi.fn(),
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

  it('returns worker-computed attachment storage', async () => {
    expect(await getStorage(deps())).toEqual({ ok: true, value: storage })
  })

  it('returns attachment/io when storage cannot be read', async () => {
    const d = deps()
    vi.mocked(d.storage).mockResolvedValue(undefined)
    expect(await getStorage(d)).toMatchObject({ ok: false, code: 'attachment/io' })
  })

  it('clears only unsent attachments and announces each affected composer', async () => {
    const d = deps()
    vi.mocked(d.list).mockReturnValue([])

    expect(await clearUnsent(d)).toEqual({
      ok: true,
      value: { removedBytes: 5, removedCount: 1 },
    })
    expect(d.notifyDrafts).toHaveBeenCalledWith('chat-1', [])
    expect(d.notifyStorage).toHaveBeenCalledOnce()
  })

  it('does nothing when unsent cleanup is cancelled', async () => {
    const d = deps()
    d.confirmClear = vi.fn(() => Promise.resolve(false))

    expect(await clearUnsent(d)).toEqual({
      ok: true,
      value: { removedBytes: 0, removedCount: 0 },
    })
    expect(d.clearUnsent).not.toHaveBeenCalled()
    expect(d.notifyStorage).not.toHaveBeenCalled()
  })

  it('returns attachment/io when unsent cleanup fails', async () => {
    const d = deps()
    vi.mocked(d.clearUnsent).mockResolvedValue(undefined)

    expect(await clearUnsent(d)).toMatchObject({ ok: false, code: 'attachment/io' })
    expect(d.notifyStorage).not.toHaveBeenCalled()
  })

  it('rejects a second cleanup while the first confirmation is open', async () => {
    const d = deps()
    let cancel = (): void => undefined
    d.confirmClear = vi.fn(() => new Promise<boolean>((resolve) => {
      cancel = () => {
        resolve(false)
      }
    }))
    const first = clearUnsent(d)

    expect(await clearUnsent(deps())).toMatchObject({ ok: false, code: 'attachment/busy' })
    cancel()
    await first
  })
})
