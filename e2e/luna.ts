/**
 * Launching the packaged app for a test, and the two things that need care.
 *
 * **A throwaway `userData`.** Luna keeps conversations, provider configuration
 * and the database itself under `app.getPath('userData')`. A test that does not
 * move that somewhere disposable runs against the developer's real Luna — and
 * one of the things worth testing is the privacy delete. Electron resolves the
 * path from `--user-data-dir`, so a fresh temporary directory per test is the
 * whole of the fix. It is not a parameter here because it must never be
 * forgotten.
 *
 * **Native dialogs.** Consent lives in `dialog.showMessageBox`, drawn by the
 * operating system rather than by our renderer. Playwright drives the renderer,
 * so there is no button for it to click. `answerDialogs` replaces the function
 * inside the running main process instead — no test-only branch in shipped
 * code, which matters most for exactly this code: a consent prompt with an
 * `if (testing)` around it is a consent prompt that can be turned off.
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Where `electron-builder --dir` leaves the app on this machine.
 *
 * Checked rather than assumed: the architecture suffix differs, and a missing
 * build should say so plainly instead of surfacing as a spawn error twenty
 * lines into a test.
 */
export function appPath(): string {
  const candidates =
    process.platform === 'darwin'
      ? [
          'release/mac-arm64/Luna.app/Contents/MacOS/Luna',
          'release/mac/Luna.app/Contents/MacOS/Luna',
          'release/mac-universal/Luna.app/Contents/MacOS/Luna',
        ]
      : ['release/win-unpacked/Luna.exe', 'release/linux-unpacked/luna']

  const found = candidates.map((path) => join(root, path)).find((path) => existsSync(path))
  if (found === undefined) {
    throw new Error(
      `No packaged app found. Run "npm run package" first.\nLooked for:\n  ${candidates.join('\n  ')}`,
    )
  }
  return found
}

export type Luna = {
  app: ElectronApplication
  /** The main window. Settings is a second one — see `openSettings`. */
  window: Page
  /** The disposable userData directory, removed by `close`. */
  userData: string
  close: () => Promise<void>
}

export async function launch(): Promise<Luna> {
  const userData = await mkdtemp(join(tmpdir(), 'luna-e2e-'))

  const app = await electron.launch({
    executablePath: appPath(),
    args: [`--user-data-dir=${userData}`],
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return {
    app,
    window,
    userData,
    close: async () => {
      await app.close().catch(() => undefined)
      await rm(userData, { recursive: true, force: true })
    },
  }
}

/**
 * Answers every native message box with one button, and counts them.
 *
 * The index is into the `buttons` array the caller passed, so a test has to
 * know which button it is agreeing to. `0` is the safe answer everywhere in
 * Luna — deny-by-default requires cancel to be both the default and the escape.
 */
export async function answerDialogs(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const store = globalThis as unknown as { __lunaDialogs?: number }
    store.__lunaDialogs = 0
    dialog.showMessageBox = () => {
      store.__lunaDialogs = (store.__lunaDialogs ?? 0) + 1
      return Promise.resolve({ response: answer, checkboxChecked: false })
    }
  }, response)
}

/** How many native boxes Luna has tried to show since `answerDialogs`. */
export async function dialogCount(app: ElectronApplication): Promise<number> {
  return await app.evaluate(() => {
    const store = globalThis as unknown as { __lunaDialogs?: number }
    return store.__lunaDialogs ?? 0
  })
}

/**
 * Opens Settings the way the app does, and returns its window.
 *
 * Through `settings:open` from the main window rather than by driving the menu,
 * so the request crosses the real IPC boundary and passes the same sender check
 * a user's click would. Luna runs a renderer per window, so what comes back is
 * a separate `Page` with its own React tree.
 */
export async function openSettings(luna: Luna): Promise<Page> {
  const opened = luna.app.waitForEvent('window')
  await luna.window.evaluate(async () => {
    await window.luna.settings.open()
  })
  const page = await opened
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** Switches to a Settings section by its navigation label. */
export async function showSection(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
}
