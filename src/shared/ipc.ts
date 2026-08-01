/**
 * The single source of truth for every renderer <-> main message.
 *
 * Adding a feature means adding a line here. The compiler then reports the
 * missing handler in src/main/ipc and the missing wrapper in src/preload.
 */

export type AppInfo = {
  name: string
  version: string
  electron: string
  platform: string
}

/** Two-way. Renderer asks, main answers. ipcRenderer.invoke / ipcMain.handle. */
export type Invocations = {
  'app:info': { req: undefined; res: AppInfo }
}

/** One-way, main -> renderer. webContents.send / ipcRenderer.on. */
export type Events = {
  'theme:changed': { dark: boolean }
}

export type Channel = keyof Invocations
export type Req<C extends Channel> = Invocations[C]['req']
export type Res<C extends Channel> = Invocations[C]['res']

export type EventName = keyof Events
export type EventData<E extends EventName> = Events[E]
