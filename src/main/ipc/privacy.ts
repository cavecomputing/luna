/**
 * Getting data out of Luna, and getting rid of it.
 *
 * Both handler bodies are plain functions of their inputs, so tests call them
 * directly without booting Electron. Every side effect — the dialogs, the
 * database swap, the broadcasts — arrives as a dependency.
 */

import { app, BrowserWindow, dialog, session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { err, ok, type Result } from '../../shared/result.js'
import type { Prefs } from '../../shared/prefs.js'
import type { Conversation, ModelSlots, Provider } from '../../shared/types.js'
import * as jobs from '../attachment-jobs.js'
import { saveArchive, type ArchiveDeps } from '../chat-export.js'
import * as chats from '../chats.js'
import * as db from '../db.js'
import { ask } from '../dialogs.js'
import * as prefs from '../prefs.js'
import { previewCache } from '../previews.js'
import * as providers from '../providers.js'
import * as secrets from '../secrets.js'
import { broadcast, handle } from './bus.js'

type Streams = {
  stopAll: () => void
  settle: () => Promise<void>
}

type Deps = {
  chats: () => Conversation[]
  archive: ArchiveDeps
  confirm: () => Promise<boolean>
  stopStreams: () => void
  settleStreams: () => Promise<void>
  clearPreviews: () => void
  clearKeys: () => Promise<void>
  clearBrowsingData: () => Promise<void>
  eraseDatabase: () => Promise<void>
  prefs: () => Prefs
  applyTheme: (value: Prefs) => void
  providers: () => Promise<Provider[]>
  slots: () => ModelSlots
  notifyPrefs: (value: Prefs) => void
  notifyProviders: (value: Provider[]) => void
  notifyModels: (value: ModelSlots) => void
  notifyChats: (value: Conversation[]) => void
  notifyAttachmentStorage: () => void
}

/**
 * Injected in registerAll rather than imported, so this file does not depend on
 * ipc/chat.ts. Same reason chats.ts takes its cancel function that way.
 */
let streams: Streams = { stopAll: () => undefined, settle: () => Promise.resolve() }

export function setStreams(value: Streams): void {
  streams = value
}

async function pickFolder(): Promise<string | undefined> {
  const options = {
    title: 'Export Conversations',
    buttonLabel: 'Export',
    properties: ['openDirectory' as const, 'createDirectory' as const],
  }
  const parent = BrowserWindow.getFocusedWindow()
  const result =
    process.platform === 'darwin' || parent === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options)
  return result.canceled ? undefined : result.filePaths[0]
}

async function confirmDeleteAll(): Promise<boolean> {
  return (
    (await ask({
      type: 'warning',
      buttons: ['Delete Everything', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: 'Delete all Luna data?',
      detail:
        'Every conversation, attachment, preference, provider, and saved API key is removed ' +
        'from this computer, along with Luna’s local backups — so nothing can be restored ' +
        'afterwards. Conversations you already exported to a file are not affected.',
    })) === 0
  )
}

async function clearBrowsingData(): Promise<void> {
  // Previews load over app://, so assistant output has passed through
  // Chromium's own on-disk caches under userData. They go too.
  await session.defaultSession.clearStorageData()
  await session.defaultSession.clearCache()
  await session.defaultSession.clearCodeCaches({})
}

const deps: Deps = {
  chats: chats.load,
  archive: {
    pickFolder,
    load: (conversationId) => jobs.readHistory(db.filePath(), conversationId),
    makeDir: (dir) => mkdir(dir),
    write: (file, data) => writeFile(file, data, { encoding: 'utf8', mode: 0o600 }),
    now: Date.now,
    version: () => app.getVersion(),
  },
  confirm: confirmDeleteAll,
  stopStreams: () => {
    streams.stopAll()
  },
  settleStreams: async () => {
    await streams.settle()
    await jobs.settle()
  },
  clearPreviews: () => {
    previewCache.clearAll()
  },
  clearKeys: secrets.clearAll,
  clearBrowsingData,
  eraseDatabase: db.eraseAll,
  prefs: prefs.load,
  applyTheme: prefs.applyTheme,
  providers: async () =>
    await Promise.all(
      providers.load().map(async (provider) => ({
        ...provider,
        hasApiKey: await secrets.has(provider.id),
      })),
    ),
  slots: providers.slots,
  notifyPrefs: (value) => {
    broadcast('prefs:changed', value)
  },
  notifyProviders: (value) => {
    broadcast('providers:changed', value)
  },
  notifyModels: (value) => {
    broadcast('models:changed', value)
  },
  notifyChats: (value) => {
    broadcast('chats:changed', value)
  },
  notifyAttachmentStorage: () => {
    broadcast('attachments:storage-changed', undefined)
  },
}

export async function exportAll(d: Deps): Promise<Result<{ written: number }>> {
  const result = await saveArchive(d.chats(), d.archive)
  return result.ok ? ok({ written: result.value }) : result
}

/** Guards a second delete while the first still owns a dialog. */
let running = false

/**
 * Announces the empty state to every window. Read from the new connection, in
 * an order the renderers can follow: models resolves a slot's provider out of
 * the provider list it was just given, and chats unmounts the thread last.
 */
async function announce(d: Deps): Promise<void> {
  d.applyTheme(d.prefs())
  d.notifyPrefs(d.prefs())
  d.notifyProviders(await d.providers())
  d.notifyModels(d.slots())
  d.notifyChats(d.chats())
  d.notifyAttachmentStorage()
}

export async function deleteAll(d: Deps): Promise<Result<{ deleted: boolean }>> {
  if (running) return err('privacy/busy', 'a delete is already in progress')
  running = true

  try {
    if (!(await d.confirm())) return ok({ deleted: false })

    d.stopStreams()
    // Aborting a stream only starts its unwind, and the unwind writes a
    // terminal row. Closing the database under it would lose that row.
    await d.settleStreams()
    d.clearPreviews()

    try {
      await d.clearKeys()
    } catch {
      return err('secret/unavailable', 'stored credentials could not be removed')
    }

    try {
      await d.clearBrowsingData()
      await d.eraseDatabase()
    } catch {
      return err('privacy/failed', 'stored data could not be removed')
    }
  } finally {
    running = false
  }

  try {
    await announce(d)
  } catch {
    // The destructive work succeeded. A window left showing stale rows until it
    // reloads is the smaller problem, and reporting failure here would be a lie.
  }
  return ok({ deleted: true })
}

export function register(): void {
  handle('privacy:export', () => exportAll(deps))
  handle('privacy:delete-all', () => deleteAll(deps))
}
