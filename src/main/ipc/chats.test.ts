import { describe, expect, it, vi } from 'vitest'
import type { Conversation, Mode } from '../../shared/types.js'
import {
  createChat,
  deleteChat,
  listChats,
  updateChatMode,
  updateChatDraft,
  updateChatPinned,
} from './chats.js'

function chat(id = 'chat-1'): Conversation {
  return {
    id,
    title: 'New chat',
    draft: '',
    icon: 'spark',
    mode: 'fast',
    pinned: false,
    updatedAt: 10,
    messages: [],
  }
}

type TestDeps = Parameters<typeof createChat>[1]

function makeDeps(): TestDeps {
  let items = [chat()]
  return {
    list: vi.fn(() => items),
    get: vi.fn((id: string) => items.find((item) => item.id === id)),
    create: vi.fn((id: string, mode: Mode, now: number) => {
      const value = { ...chat(id), mode, updatedAt: now }
      items = [value, ...items]
      return value
    }),
    setMode: vi.fn((id: string, mode: Mode) => {
      const found = items.find((item) => item.id === id)
      if (found === undefined) return undefined
      const value = { ...found, mode }
      items = items.map((item) => (item.id === id ? value : item))
      return value
    }),
    setDraft: vi.fn((id: string, draft: string) => {
      const found = items.find((item) => item.id === id)
      if (found === undefined) return false
      items = items.map((item) => (item.id === id ? { ...item, draft } : item))
      return true
    }),
    setPinned: vi.fn((id: string, pinned: boolean) => {
      const found = items.find((item) => item.id === id)
      if (found === undefined) return undefined
      const value = { ...found, pinned }
      items = items.map((item) => (item.id === id ? value : item))
      return value
    }),
    remove: vi.fn((id: string) => {
      const before = items.length
      items = items.filter((item) => item.id !== id)
      return items.length !== before
    }),
    newId: vi.fn(() => 'chat-new'),
    now: vi.fn(() => 20),
    notify: vi.fn(),
    cancelConversation: vi.fn(),
    confirmDelete: vi.fn(() => Promise.resolve(true)),
  }
}

describe('conversation IPC actions', () => {
  it('lists and creates conversations', () => {
    const d = makeDeps()
    expect(listChats(d)).toEqual({ ok: true, value: [chat()] })
    expect(createChat({ mode: 'expert' }, d)).toMatchObject({
      ok: true,
      value: { id: 'chat-new', mode: 'expert' },
    })
    expect(d.notify).toHaveBeenCalledTimes(1)
  })

  it('updates mode and pin state', () => {
    const d = makeDeps()
    expect(updateChatMode({ id: 'chat-1', mode: 'expert' }, d)).toMatchObject({
      ok: true,
      value: { mode: 'expert' },
    })
    expect(updateChatPinned({ id: 'chat-1', pinned: true }, d)).toMatchObject({
      ok: true,
      value: { pinned: true },
    })
    expect(d.notify).toHaveBeenCalledTimes(2)
  })

  it('persists a conversation draft without broadcasting the full chat list', () => {
    const d = makeDeps()
    expect(updateChatDraft({ id: 'chat-1', draft: 'unfinished thought' }, d)).toEqual({
      ok: true,
      value: undefined,
    })
    expect(d.setDraft).toHaveBeenCalledWith('chat-1', 'unfinished thought')
    expect(d.notify).not.toHaveBeenCalled()
  })

  it('cancels an active request before deleting its confirmed conversation', async () => {
    const d = makeDeps()
    expect(await deleteChat({ id: 'chat-1' }, d)).toEqual({ ok: true, value: undefined })
    expect(d.cancelConversation).toHaveBeenCalledWith('chat-1')
    expect(d.remove).toHaveBeenCalledWith('chat-1')
  })

  it('keeps a conversation when deletion is cancelled', async () => {
    const d = makeDeps()
    d.confirmDelete = vi.fn(() => Promise.resolve(false))

    expect(await deleteChat({ id: 'chat-1' }, d)).toEqual({ ok: true, value: undefined })
    expect(d.cancelConversation).not.toHaveBeenCalled()
    expect(d.remove).not.toHaveBeenCalled()
    expect(d.notify).not.toHaveBeenCalled()
  })

  it.each([
    [() => createChat({ mode: 'turbo' }, makeDeps()), 'chat/invalid'],
    [() => updateChatMode({ id: '../bad', mode: 'fast' }, makeDeps()), 'chat/invalid'],
    [() => updateChatDraft({ id: 'chat-1', draft: 42 }, makeDeps()), 'chat/invalid'],
    [() => updateChatDraft({ id: 'missing', draft: 'text' }, makeDeps()), 'chat/missing'],
    [() => updateChatPinned({ id: 'chat-1', pinned: 'yes' }, makeDeps()), 'chat/invalid'],
    [() => deleteChat({ id: 'missing' }, makeDeps()), 'chat/missing'],
  ])('returns a stable error for invalid or missing input', async (run, code) => {
    expect(await run()).toMatchObject({ ok: false, code })
  })
})
