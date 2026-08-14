import { describe, expect, it, vi } from 'vitest'
import type { Conversation, Mode } from '../../shared/types.js'
import {
  createChat,
  deleteChat,
  listChats,
  showChatMenu,
  updateChatMode,
  updateChatDraft,
  updateChatPinned,
  updateChatTitle,
} from './chats.js'

function chat(id = 'chat-1'): Conversation {
  return {
    id,
    title: 'New chat',
    draft: '',
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
    setTitle: vi.fn((id: string, title: string) => {
      const found = items.find((item) => item.id === id)
      if (found === undefined) return undefined
      const value = { ...found, title }
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
    notifyAttachmentStorage: vi.fn(),
  }
}

describe('conversation IPC actions', () => {
  it('opens a conversation menu wired to pin, rename, export, and delete actions', () => {
    const togglePinned = vi.fn()
    const rename = vi.fn()
    const exportChat = vi.fn()
    const remove = vi.fn()
    const show = vi.fn((
      _chat: Conversation,
      pin: () => void,
      renameChat: () => void,
      saveChat: () => void,
      deleteChat: () => void,
    ) => {
      pin()
      renameChat()
      saveChat()
      deleteChat()
    })

    expect(showChatMenu({ id: 'chat-1' }, {
      get: (id) => id === 'chat-1' ? chat() : undefined,
      togglePinned,
      rename,
      exportChat,
      remove,
      show,
    })).toEqual({ ok: true, value: undefined })
    expect(togglePinned).toHaveBeenCalledWith('chat-1', true)
    expect(rename).toHaveBeenCalledWith('chat-1')
    expect(exportChat).toHaveBeenCalledWith(chat())
    expect(remove).toHaveBeenCalledWith('chat-1')
  })

  it('rejects invalid and missing conversations before opening a menu', () => {
    const d = {
      get: vi.fn(() => undefined),
      togglePinned: vi.fn(),
      rename: vi.fn(),
      exportChat: vi.fn(),
      remove: vi.fn(),
      show: vi.fn(),
    }

    expect(showChatMenu({ id: '../bad' }, d)).toMatchObject({ ok: false, code: 'chat/invalid' })
    expect(showChatMenu({ id: 'missing' }, d)).toMatchObject({ ok: false, code: 'chat/missing' })
    expect(d.show).not.toHaveBeenCalled()
  })

  it('lists and creates conversations', () => {
    const d = makeDeps()
    expect(listChats(d)).toEqual({ ok: true, value: [chat()] })
    expect(createChat({ mode: 'expert' }, d)).toMatchObject({
      ok: true,
      value: { id: 'chat-new', mode: 'expert' },
    })
    expect(d.notify).toHaveBeenCalledTimes(1)
  })

  it('updates mode, title, and pin state', () => {
    const d = makeDeps()
    expect(updateChatMode({ id: 'chat-1', mode: 'expert' }, d)).toMatchObject({
      ok: true,
      value: { mode: 'expert' },
    })
    expect(updateChatPinned({ id: 'chat-1', pinned: true }, d)).toMatchObject({
      ok: true,
      value: { pinned: true },
    })
    expect(updateChatTitle({ id: 'chat-1', title: '  Better title  ' }, d)).toMatchObject({
      ok: true,
      value: { title: 'Better title' },
    })
    expect(d.notify).toHaveBeenCalledTimes(3)
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
    expect(d.notifyAttachmentStorage).toHaveBeenCalledOnce()
  })

  it('keeps a conversation when deletion is cancelled', async () => {
    const d = makeDeps()
    d.confirmDelete = vi.fn(() => Promise.resolve(false))

    expect(await deleteChat({ id: 'chat-1' }, d)).toEqual({ ok: true, value: undefined })
    expect(d.cancelConversation).not.toHaveBeenCalled()
    expect(d.remove).not.toHaveBeenCalled()
    expect(d.notify).not.toHaveBeenCalled()
    expect(d.notifyAttachmentStorage).not.toHaveBeenCalled()
  })

  it.each([
    [() => createChat({ mode: 'turbo' }, makeDeps()), 'chat/invalid'],
    [() => updateChatMode({ id: '../bad', mode: 'fast' }, makeDeps()), 'chat/invalid'],
    [() => updateChatDraft({ id: 'chat-1', draft: 42 }, makeDeps()), 'chat/invalid'],
    [() => updateChatDraft({ id: 'missing', draft: 'text' }, makeDeps()), 'chat/missing'],
    [() => updateChatPinned({ id: 'chat-1', pinned: 'yes' }, makeDeps()), 'chat/invalid'],
    [() => updateChatTitle({ id: 'chat-1', title: '   ' }, makeDeps()), 'chat/invalid'],
    [() => updateChatTitle({ id: 'missing', title: 'Title' }, makeDeps()), 'chat/missing'],
    [() => deleteChat({ id: 'missing' }, makeDeps()), 'chat/missing'],
  ])('returns a stable error for invalid or missing input', async (run, code) => {
    expect(await run()).toMatchObject({ ok: false, code })
  })
})
