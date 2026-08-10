import { describe, expect, it, vi } from 'vitest'
import type { Conversation, Mode } from '../../shared/types.js'
import {
  createChat,
  deleteChat,
  listChats,
  updateChatMode,
  updateChatPinned,
} from './chats.js'

function chat(id = 'chat-1'): Conversation {
  return {
    id,
    title: 'New chat',
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

  it('cancels an active request before deleting its conversation', () => {
    const d = makeDeps()
    expect(deleteChat({ id: 'chat-1' }, d)).toEqual({ ok: true, value: undefined })
    expect(d.cancelConversation).toHaveBeenCalledWith('chat-1')
    expect(d.remove).toHaveBeenCalledWith('chat-1')
  })

  it.each([
    [() => createChat({ mode: 'turbo' }, makeDeps()), 'chat/invalid'],
    [() => updateChatMode({ id: '../bad', mode: 'fast' }, makeDeps()), 'chat/invalid'],
    [() => updateChatPinned({ id: 'chat-1', pinned: 'yes' }, makeDeps()), 'chat/invalid'],
    [() => deleteChat({ id: 'missing' }, makeDeps()), 'chat/missing'],
  ])('returns a stable error for invalid or missing input', (run, code) => {
    expect(run()).toMatchObject({ ok: false, code })
  })
})
