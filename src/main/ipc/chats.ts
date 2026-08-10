import { randomUUID } from 'node:crypto'
import type { MessageBoxOptions } from 'electron'
import { err, ok, type Result } from '../../shared/result.js'
import type { Conversation, Mode } from '../../shared/types.js'
import * as chats from '../chats.js'
import * as db from '../db.js'
import { broadcast, handle } from './bus.js'

type Deps = {
  list: () => Conversation[]
  get: (id: string) => Conversation | undefined
  create: (id: string, mode: Mode, now: number) => Conversation
  setMode: (id: string, mode: Mode) => Conversation | undefined
  setDraft: (id: string, draft: string) => boolean
  setPinned: (id: string, pinned: boolean) => Conversation | undefined
  remove: (id: string) => boolean
  newId: () => string
  now: () => number
  notify: (value: Conversation[]) => void
  cancelConversation: (id: string) => void
  confirmDelete: () => Promise<boolean>
}

async function confirmDelete(): Promise<boolean> {
  const { BrowserWindow, dialog } = await import('electron')
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
    parent === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(parent, options)
  return result.response === 0
}

const deps: Deps = {
  list: chats.load,
  get: chats.get,
  create: (id, mode, now) => chats.create(db.handle(), id, mode, now),
  setMode: (id, mode) => chats.setMode(db.handle(), id, mode),
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

function object(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? { ...input } : undefined
}

function id(input: unknown): string | undefined {
  return typeof input === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(input)
    ? input
    : undefined
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

export function setCancelConversation(fn: (id: string) => void): void {
  deps.cancelConversation = fn
}

export function register(): void {
  handle('chats:list', () => listChats(deps))
  handle('chats:create', (_event, req) => createChat(req, deps))
  handle('chats:set-mode', (_event, req) => updateChatMode(req, deps))
  handle('chats:set-draft', (_event, req) => updateChatDraft(req, deps))
  handle('chats:set-pinned', (_event, req) => updateChatPinned(req, deps))
  handle('chats:delete', (_event, req) => deleteChat(req, deps))
}
