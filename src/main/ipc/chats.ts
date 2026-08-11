import { randomUUID } from 'node:crypto'
import {
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type WebContents,
} from 'electron'
import { err, ok, type Result } from '../../shared/result.js'
import type { Conversation, Mode } from '../../shared/types.js'
import * as chats from '../chats.js'
import * as db from '../db.js'
import { id, object, text } from '../parse.js'
import { broadcast, emit, handle } from './bus.js'

type Deps = {
  list: () => Conversation[]
  get: (id: string) => Conversation | undefined
  create: (id: string, mode: Mode, now: number) => Conversation
  setMode: (id: string, mode: Mode) => Conversation | undefined
  setTitle: (id: string, title: string) => Conversation | undefined
  setDraft: (id: string, draft: string) => boolean
  setPinned: (id: string, pinned: boolean) => Conversation | undefined
  remove: (id: string) => boolean
  newId: () => string
  now: () => number
  notify: (value: Conversation[]) => void
  cancelConversation: (id: string) => void
  confirmDelete: () => Promise<boolean>
}

type MenuDeps = {
  get: (id: string) => Conversation | undefined
  togglePinned: (id: string, pinned: boolean) => void
  rename: (id: string) => void
  remove: (id: string) => void
  show: (
    chat: Conversation,
    togglePinned: () => void,
    rename: () => void,
    remove: () => void,
  ) => void
}

async function confirmDelete(): Promise<boolean> {
  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: 'Delete this conversation?',
    detail: 'This cannot be undone.',
  }
  const parent = BrowserWindow.getFocusedWindow()
  const result =
    process.platform === 'darwin' || parent === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(parent, options)
  return result.response === 0
}

const deps: Deps = {
  list: chats.load,
  get: chats.get,
  create: (id, mode, now) => chats.create(db.handle(), id, mode, now),
  setMode: (id, mode) => chats.setMode(db.handle(), id, mode),
  setTitle: (id, title) => chats.setTitle(db.handle(), id, title),
  setDraft: (id, draft) => chats.setDraft(db.handle(), id, draft),
  setPinned: (id, pinned) => chats.setPinned(db.handle(), id, pinned),
  remove: (id) => chats.remove(db.handle(), id),
  newId: randomUUID,
  now: Date.now,
  notify: (value) => {
    broadcast('chats:changed', value)
  },
  cancelConversation: (id) => {
    void id
  },
  confirmDelete,
}

function announce(d: Deps): void {
  d.notify(d.list())
}

export function listChats(d: Deps): Result<Conversation[]> {
  return ok(d.list())
}

export function createChat(input: unknown, d: Deps): Result<Conversation> {
  const req = object(input)
  if (req === undefined || (req.mode !== 'fast' && req.mode !== 'expert')) {
    return err('chat/invalid', 'conversation mode was invalid')
  }
  const value = d.create(d.newId(), req.mode, d.now())
  announce(d)
  return ok(value)
}

export function updateChatMode(input: unknown, d: Deps): Result<Conversation> {
  const req = object(input)
  if (req === undefined) return err('chat/invalid', 'conversation mode update was invalid')
  const chatId = id(req.id)
  if (chatId === undefined || (req.mode !== 'fast' && req.mode !== 'expert')) {
    return err('chat/invalid', 'conversation mode update was invalid')
  }
  const value = d.setMode(chatId, req.mode)
  if (value === undefined) return err('chat/missing', 'conversation was not found')
  announce(d)
  return ok(value)
}

export function updateChatDraft(input: unknown, d: Deps): Result<undefined> {
  const req = object(input)
  const chatId = id(req?.id)
  if (chatId === undefined || typeof req?.draft !== 'string' || req.draft.length > 100_000) {
    return err('chat/invalid', 'conversation draft was invalid')
  }
  if (!d.setDraft(chatId, req.draft)) return err('chat/missing', 'conversation was not found')
  return ok(undefined)
}

export function updateChatPinned(input: unknown, d: Deps): Result<Conversation> {
  const req = object(input)
  const chatId = id(req?.id)
  if (chatId === undefined || typeof req?.pinned !== 'boolean') {
    return err('chat/invalid', 'conversation pin update was invalid')
  }
  const value = d.setPinned(chatId, req.pinned)
  if (value === undefined) return err('chat/missing', 'conversation was not found')
  announce(d)
  return ok(value)
}

export function updateChatTitle(input: unknown, d: Deps): Result<Conversation> {
  const req = object(input)
  const chatId = id(req?.id)
  const title = text(req?.title, 200)
  if (chatId === undefined || title === undefined || title === '') {
    return err('chat/invalid', 'conversation title was invalid')
  }
  const value = d.setTitle(chatId, title)
  if (value === undefined) return err('chat/missing', 'conversation was not found')
  announce(d)
  return ok(value)
}

export async function deleteChat(input: unknown, d: Deps): Promise<Result<undefined>> {
  const req = object(input)
  const chatId = id(req?.id)
  if (chatId === undefined) return err('chat/invalid', 'conversation id was invalid')
  if (d.get(chatId) === undefined) return err('chat/missing', 'conversation was not found')
  if (!(await d.confirmDelete())) return ok(undefined)
  d.cancelConversation(chatId)
  d.remove(chatId)
  announce(d)
  return ok(undefined)
}

export function showChatMenu(input: unknown, d: MenuDeps): Result<undefined> {
  const chatId = id(object(input)?.id)
  if (chatId === undefined) return err('chat/invalid', 'conversation id was invalid')
  const chat = d.get(chatId)
  if (chat === undefined) return err('chat/missing', 'conversation was not found')
  d.show(
    chat,
    () => {
      d.togglePinned(chat.id, !chat.pinned)
    },
    () => {
      d.rename(chat.id)
    },
    () => {
      d.remove(chat.id)
    },
  )
  return ok(undefined)
}

function popup(
  sender: WebContents,
  chat: Conversation,
  togglePinned: () => void,
  rename: () => void,
  remove: () => void,
): void {
  const template: MenuItemConstructorOptions[] = [
    { label: chat.pinned ? 'Unpin Conversation' : 'Pin Conversation', click: togglePinned },
    { label: 'Rename Conversation', click: rename },
    { type: 'separator' },
    { label: 'Delete Conversation', click: remove },
  ]
  const menu = Menu.buildFromTemplate(template)
  const window = BrowserWindow.fromWebContents(sender)
  menu.popup(window === null ? {} : { window })
}

export function setCancelConversation(fn: (id: string) => void): void {
  deps.cancelConversation = fn
}

export function register(): void {
  handle('chats:list', () => listChats(deps))
  handle('chats:create', (_event, req) => createChat(req, deps))
  handle('chats:set-mode', (_event, req) => updateChatMode(req, deps))
  handle('chats:set-draft', (_event, req) => updateChatDraft(req, deps))
  handle('chats:set-pinned', (_event, req) => updateChatPinned(req, deps))
  handle('chats:rename', (_event, req) => updateChatTitle(req, deps))
  handle('chats:delete', (_event, req) => deleteChat(req, deps))
  handle('chats:menu', (event, req) =>
    showChatMenu(req, {
      get: deps.get,
      togglePinned: (id, pinned) => {
        updateChatPinned({ id, pinned }, deps)
      },
      rename: (id) => {
        emit(event.sender, 'chats:rename-requested', { id })
      },
      remove: (id) => {
        void deleteChat({ id }, deps).catch(() => undefined)
      },
      show: (chat, togglePinned, rename, remove) => {
        popup(event.sender, chat, togglePinned, rename, remove)
      },
    }),
  )
}
