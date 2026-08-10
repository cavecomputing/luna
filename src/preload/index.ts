import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Channel, EventData, EventName, Req, Res } from '../shared/ipc.js'
import type { Prefs } from '../shared/prefs.js'
import type { Result } from '../shared/result.js'
import type { Mode, ProviderDraft } from '../shared/types.js'

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
    setPinned: (id: string, pinned: boolean) =>
      invoke('chats:set-pinned', { id, pinned }),
    delete: (id: string) => invoke('chats:delete', { id }),
  },
  chat: {
    send: (conversationId: string, text: string) =>
      invoke('chat:send', { conversationId, text }),
    cancel: (messageId: string) => invoke('chat:cancel', { messageId }),
  },
  settings: {
    open: () => invoke('settings:open', undefined),
  },
  onTheme: (fn: (data: EventData<'theme:changed'>) => void) => subscribe('theme:changed', fn),
  onPrefs: (fn: (data: EventData<'prefs:changed'>) => void) => subscribe('prefs:changed', fn),
  onProviders: (fn: (data: EventData<'providers:changed'>) => void) =>
    subscribe('providers:changed', fn),
  onModels: (fn: (data: EventData<'models:changed'>) => void) =>
    subscribe('models:changed', fn),
  onChats: (fn: (data: EventData<'chats:changed'>) => void) =>
    subscribe('chats:changed', fn),
  onChatDelta: (fn: (data: EventData<'chat:delta'>) => void) =>
    subscribe('chat:delta', fn),
  onChatDone: (fn: (data: EventData<'chat:done'>) => void) =>
    subscribe('chat:done', fn),
  onChatError: (fn: (data: EventData<'chat:error'>) => void) =>
    subscribe('chat:error', fn),
}

contextBridge.exposeInMainWorld('luna', api)

export type LunaApi = typeof api
