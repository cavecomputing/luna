import { BrowserWindow, app, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { Channel, Req, Res } from '../../shared/ipc.js'
import type { EventData, EventName } from '../../shared/ipc.js'
import { err, type Result } from '../../shared/result.js'
import { APP_ORIGIN } from '../protocol.js'

type Handler<C extends Channel> = (
  event: IpcMainInvokeEvent,
  req: Req<C>,
) => Result<Res<C>> | Promise<Result<Res<C>>>

/**
 * Treat the renderer as an untrusted client. A compromised page can send any
 * message on any channel, so every privileged handler checks where it came from.
 *
 * Plain function of its inputs so tests don't boot Electron. `packaged` comes
 * from `app.isPackaged` at the call site — never from the environment, which a
 * packaged app does not set and an attacker could.
 */
export function trustedSender(url: string | undefined, packaged: boolean): boolean {
  if (url === undefined) return false
  if (url.startsWith(`${APP_ORIGIN}/`) || url === APP_ORIGIN) return true
  // Vite dev server, dev builds only.
  return !packaged && url.startsWith('http://localhost:')
}

/**
 * Typed wrapper over ipcMain.handle. Validates the sender, and converts any
 * escaped throw into an Err so nothing crosses the boundary as a rejection.
 */
export function handle<C extends Channel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, async (event, req: Req<C>) => {
    if (!trustedSender(event.senderFrame?.url, app.isPackaged)) {
      return err('ipc/untrusted-sender', `rejected ${channel}`)
    }
    try {
      return await fn(event, req)
    } catch {
      return err('ipc/handler-threw', `unhandled failure in ${channel}`)
    }
  })
}

/** Typed wrapper over webContents.send for main -> renderer pushes. */
export function emit<E extends EventName>(
  target: WebContents,
  event: E,
  data: EventData<E>,
): void {
  if (target.isDestroyed()) return
  target.send(event, data)
}

/**
 * Push to every open window. Luna runs a renderer per window, so a change made
 * in Settings reaches the main window only because this exists. The window that
 * caused the change is not exempt — it learns the same way as the others.
 */
export function broadcast<E extends EventName>(event: E, data: EventData<E>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    emit(win.webContents, event, data)
  }
}
