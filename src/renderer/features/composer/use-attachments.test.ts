// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AttachmentMeta } from '../../../shared/types.js'
import { useAttachments } from './use-attachments.js'

const meta: AttachmentMeta = {
  id: 'file-1',
  name: 'notes.txt',
  kind: 'text',
  mediaType: 'text/plain',
  size: 5,
}

function bridge(initial: AttachmentMeta[] = []) {
  const add = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: [meta], rejected: [] } }))
  const list = vi.fn(() => Promise.resolve({ ok: true as const, value: initial }))
  const remove = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      attachments: {
        add,
        list,
        remove,
      },
      onAttachments: () => () => undefined,
    },
  })
  return { add, list, remove }
}

describe('useAttachments', () => {
  it('loads persistent drafts for the open conversation', async () => {
    const api = bridge([meta])
    const { result } = renderHook(() =>
      useAttachments('chat-1', () => Promise.resolve({ id: 'chat-1' })),
    )
    await waitFor(() => {
      expect(result.current.items).toEqual([meta])
    })
    expect(api.list).toHaveBeenCalledWith('chat-1')
  })

  it('creates a conversation and imports browser bytes', async () => {
    const api = bridge()
    const ensure = vi.fn(() => Promise.resolve({ id: 'chat-1' }))
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode('hello').buffer),
    })
    const { result } = renderHook(() => useAttachments(undefined, ensure))

    await act(async () => {
      await result.current.add([file])
    })

    expect(ensure).toHaveBeenCalled()
    expect(api.add).toHaveBeenCalledWith('chat-1', [
      expect.objectContaining({ name: 'notes.txt', mediaType: 'text/plain' }),
    ])
    expect(result.current.items).toEqual([meta])
  })

  it('removes a draft from main and local state', async () => {
    const api = bridge([meta])
    const { result } = renderHook(() =>
      useAttachments('chat-1', () => Promise.resolve({ id: 'chat-1' })),
    )
    await waitFor(() => {
      expect(result.current.items).toEqual([meta])
    })
    await act(async () => {
      await result.current.remove('file-1')
    })
    expect(api.remove).toHaveBeenCalledWith('chat-1', 'file-1')
    expect(result.current.items).toEqual([])
  })
})
