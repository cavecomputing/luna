import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Channel, EventData, EventName, Req, Res } from '../shared/ipc.js'
import type { Prefs } from '../shared/prefs.js'
import type { Result } from '../shared/result.js'
import type { Mode, ProviderDraft } from '../shared/types.js'
import type { AttachmentInput } from '../shared/ipc.js'

function invoke<C extends Channel>(channel: C, req: Req<C>): Promise<Result<Res<C>>> {
  return ipcRenderer.invoke(channel, req) as Promise<Result<Res<C>>>
}

/**
 * Never hand the raw listener to ipcRenderer.on. Its first argument is an
 * IpcRendererEvent carrying `sender`, which would give the page a route back
 * into the IPC system.
 */
function subscribe<E extends EventName>(
  event: E,
  fn: (data: EventData<E>) => void,
): () => void {
  const wrapped = (_e: IpcRendererEvent, data: EventData<E>): void => {
    fn(data)
  }
  ipcRenderer.on(event, wrapped)
  return () => {
    ipcRenderer.off(event, wrapped)
  }
}

/** The entire surface the renderer can reach. Wrappers only, no logic. */
const api = {
  /** Synchronous because window chrome cannot shift after the first paint. */
  platform: process.platform,
  app: {
    info: () => invoke('app:info', undefined),
    recover: () => invoke('app:recover', undefined),
    closeWindow: () => invoke('app:close-window', undefined),
    setModal: (open: boolean) => invoke('app:set-modal', open),
  },
  recovery: {
    status: () => invoke('recovery:status', undefined),
    restore: () => invoke('recovery:restore', undefined),
    retry: () => invoke('recovery:retry', undefined),
    startFresh: () => invoke('recovery:start-fresh', undefined),
    quit: () => invoke('recovery:quit', undefined),
  },
  prefs: {
    get: () => invoke('prefs:get', undefined),
    set: (prefs: Prefs) => invoke('prefs:set', prefs),
  },
  providers: {
    list: () => invoke('providers:list', undefined),
    create: (provider: ProviderDraft) => invoke('providers:create', provider),
    update: (id: string, provider: ProviderDraft) =>
      invoke('providers:update', { id, provider }),
    delete: (id: string) => invoke('providers:delete', { id }),
    setKey: (id: string, apiKey: string | null) =>
      invoke('providers:set-key', { id, apiKey }),
    models: (id: string) => invoke('providers:models', { id }),
  },
  models: {
    get: () => invoke('models:get', undefined),
    set: (slot: Mode, providerId: string | null, model: string) =>
      invoke('models:set', { slot, providerId, model }),
  },
  chats: {
    list: () => invoke('chats:list', undefined),
    create: (mode: Mode) => invoke('chats:create', { mode }),
    setMode: (id: string, mode: Mode) => invoke('chats:set-mode', { id, mode }),
    setDraft: (id: string, draft: string) => invoke('chats:set-draft', { id, draft }),
    setPinned: (id: string, pinned: boolean) =>
      invoke('chats:set-pinned', { id, pinned }),
    rename: (id: string, title: string) => invoke('chats:rename', { id, title }),
    delete: (id: string) => invoke('chats:delete', { id }),
    menu: (id: string) => invoke('chats:menu', { id }),
  },
  attachments: {
    add: (conversationId: string, files: AttachmentInput[]) =>
      invoke('attachments:add', { conversationId, files }),
    list: (conversationId: string) => invoke('attachments:list', { conversationId }),
    remove: (conversationId: string, id: string) =>
      invoke('attachments:remove', { conversationId, id }),
    read: (conversationId: string, id: string) =>
      invoke('attachments:read', { conversationId, id }),
  },
  chat: {
    send: (conversationId: string, text: string, attachmentIds: string[]) =>
      invoke('chat:send', { conversationId, text, attachmentIds }),
    cancel: (messageId: string) => invoke('chat:cancel', { messageId }),
  },
  messages: {
    menu: (id: string) => invoke('messages:menu', { id }),
  },
  preview: {
    create: (html: string) => invoke('preview:create', { html }),
    release: (id: string) => invoke('preview:release', { id }),
  },
  settings: {
    open: () => invoke('settings:open', undefined),
    close: () => invoke('settings:close', undefined),
  },
  privacy: {
    exportAll: () => invoke('privacy:export', undefined),
    deleteAll: () => invoke('privacy:delete-all', undefined),
  },
  onNewChat: (fn: () => void) => subscribe('shortcut:new-chat', fn),
  onCommandPalette: (fn: () => void) => subscribe('shortcut:command-palette', fn),
  onToggleSidebar: (fn: () => void) => subscribe('shortcut:toggle-sidebar', fn),
  onToggleMode: (fn: () => void) => subscribe('shortcut:toggle-mode', fn),
  onSettingsClose: (fn: () => void) => subscribe('settings:close-requested', fn),
  onRenameChat: (fn: (data: EventData<'chats:rename-requested'>) => void) =>
    subscribe('chats:rename-requested', fn),
  onTheme: (fn: (data: EventData<'theme:changed'>) => void) => subscribe('theme:changed', fn),
  onPrefs: (fn: (data: EventData<'prefs:changed'>) => void) => subscribe('prefs:changed', fn),
  onProviders: (fn: (data: EventData<'providers:changed'>) => void) =>
    subscribe('providers:changed', fn),
  onModels: (fn: (data: EventData<'models:changed'>) => void) =>
    subscribe('models:changed', fn),
  onChats: (fn: (data: EventData<'chats:changed'>) => void) =>
    subscribe('chats:changed', fn),
  onAttachments: (fn: (data: EventData<'attachments:changed'>) => void) =>
    subscribe('attachments:changed', fn),
  onChatDelta: (fn: (data: EventData<'chat:delta'>) => void) =>
    subscribe('chat:delta', fn),
  onChatDone: (fn: (data: EventData<'chat:done'>) => void) =>
    subscribe('chat:done', fn),
  onChatError: (fn: (data: EventData<'chat:error'>) => void) =>
    subscribe('chat:error', fn),
}

contextBridge.exposeInMainWorld('luna', api)

export type LunaApi = typeof api
