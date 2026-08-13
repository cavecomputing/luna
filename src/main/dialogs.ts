import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'

/** Shows an app-modal message on macOS and parents it to the focused window elsewhere. */
export async function ask(options: MessageBoxOptions): Promise<number> {
  const parent = BrowserWindow.getFocusedWindow()
  const result =
    process.platform === 'darwin' || parent === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(parent, options)
  return result.response
}
