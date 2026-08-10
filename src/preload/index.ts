import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Channel, EventData, EventName, Req, Res } from '../shared/ipc.js'
import type { Prefs } from '../shared/prefs.js'
import type { Result } from '../shared/result.js'

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
  settings: {
    open: () => invoke('settings:open', undefined),
  },
  onTheme: (fn: (data: EventData<'theme:changed'>) => void) => subscribe('theme:changed', fn),
  onPrefs: (fn: (data: EventData<'prefs:changed'>) => void) => subscribe('prefs:changed', fn),
}

contextBridge.exposeInMainWorld('luna', api)

export type LunaApi = typeof api
