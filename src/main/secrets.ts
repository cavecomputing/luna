/**
 * Credentials at rest.
 *
 * Two kinds live here and both follow the same rule: encrypted by the platform
 * (Keychain on macOS, DPAPI-backed on Windows), written and read only in main,
 * never in the database, never in `shared/`, never across IPC.
 *
 * - One API key per provider, in `provider-keys/`.
 * - One set of environment variables per MCP server, in `mcp-env/`. A server is
 *   an arbitrary program the user chose, and the tokens it needs are as
 *   sensitive as a provider key — more so, since the server decides what to do
 *   with them.
 *
 * The two directories are kept apart so removing one kind cannot half-remove
 * the other, and so a provider id can never address a server's secrets.
 */

import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_ENV_VALUE, isEnvName } from '../shared/mcp.js'
import { id, record, text } from './parse.js'

type Cipher = {
  available: () => boolean
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
}

type Files = {
  mkdir: typeof mkdir
  readFile: typeof readFile
  rm: typeof rm
  stat: typeof stat
  writeFile: typeof writeFile
}

const files: Files = { mkdir, readFile, rm, stat, writeFile }

const cipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
}

function file(dir: string, providerId: string): string {
  if (id(providerId) === undefined) throw new Error('invalid provider id')
  return join(dir, `${providerId}.key`)
}

export async function hasAt(dir: string, id: string, fs: Files = files): Promise<boolean> {
  try {
    await fs.stat(file(dir, id))
    return true
  } catch {
    return false
  }
}

export async function readAt(
  dir: string,
  id: string,
  crypto: Cipher = cipher,
  fs: Files = files,
): Promise<string | undefined> {
  if (!crypto.available()) throw new Error('secure storage unavailable')

  let encrypted: Buffer
  try {
    encrypted = await fs.readFile(file(dir, id))
  } catch {
    return undefined
  }
  return crypto.decrypt(encrypted)
}

export async function writeAt(
  dir: string,
  id: string,
  value: string,
  crypto: Cipher = cipher,
  fs: Files = files,
): Promise<void> {
  if (!crypto.available()) throw new Error('secure storage unavailable')
  const encrypted = crypto.encrypt(value)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file(dir, id), encrypted, { mode: 0o600 })
}

export async function clearAt(dir: string, id: string, fs: Files = files): Promise<void> {
  await fs.rm(file(dir, id), { force: true })
}

/**
 * Removes every stored key at once. The whole directory goes, rather than a
 * file per known provider: that also takes an orphan left by an interrupted
 * delete, which a loop over current provider ids would miss. `writeAt` recreates
 * the directory on the next write.
 *
 * Unlike every other function here this does not check `available()`. Removing
 * a file decrypts nothing, and a user whose secure storage is broken is exactly
 * the one who most needs their keys gone.
 */
export async function clearAllAt(dir: string, fs: Files = files): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

export function directory(): string {
  return join(app.getPath('userData'), 'provider-keys')
}

export function mcpDirectory(): string {
  return join(app.getPath('userData'), 'mcp-env')
}

/**
 * A server's environment, as one encrypted blob rather than a file per
 * variable.
 *
 * Whole-or-nothing on the way out: a server started with half its variables
 * fails in a way that looks like a bad token rather than a missing one, and
 * that is a bad afternoon. A name that no longer parses invalidates the set,
 * because it means the file is not what we wrote.
 */
export async function readEnvAt(
  dir: string,
  serverId: string,
  crypto: Cipher = cipher,
  fs: Files = files,
): Promise<Record<string, string> | undefined> {
  const raw = await readAt(dir, serverId, crypto, fs)
  if (raw === undefined) return undefined

  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return undefined
  }
  const parsed = record(decoded, (value) => text(value, MAX_ENV_VALUE))
  if (parsed === undefined) return undefined
  return Object.keys(parsed).every(isEnvName) ? parsed : undefined
}

/**
 * Async so a rejected name rejects rather than throwing past the caller's
 * `await`. Everything here is on a promise-returning path, and a validator that
 * threw synchronously would be caught in a different place than a write that
 * failed — which is the sort of difference nobody notices until it matters.
 */
export async function writeEnvAt(
  dir: string,
  serverId: string,
  values: Record<string, string>,
  crypto: Cipher = cipher,
  fs: Files = files,
): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    if (!isEnvName(name) || value.length > MAX_ENV_VALUE) {
      throw new Error('invalid environment variable')
    }
  }
  await writeAt(dir, serverId, JSON.stringify(values), crypto, fs)
}

export function readEnv(serverId: string): Promise<Record<string, string> | undefined> {
  return readEnvAt(mcpDirectory(), serverId)
}

export function writeEnv(serverId: string, values: Record<string, string>): Promise<void> {
  return writeEnvAt(mcpDirectory(), serverId, values)
}

export function hasEnv(serverId: string): Promise<boolean> {
  return hasAt(mcpDirectory(), serverId)
}

export function clearEnv(serverId: string): Promise<void> {
  return clearAt(mcpDirectory(), serverId)
}

export function has(id: string): Promise<boolean> {
  return hasAt(directory(), id)
}

export function read(id: string): Promise<string | undefined> {
  return readAt(directory(), id)
}

export function write(id: string, value: string): Promise<void> {
  return writeAt(directory(), id, value)
}

export function clear(id: string): Promise<void> {
  return clearAt(directory(), id)
}

/**
 * Every stored credential of both kinds, for the privacy delete.
 *
 * Both directories go, and a failure on either is a failure overall: reporting
 * success while a server's tokens are still on disk would be a lie about the
 * one operation where that matters most.
 */
export async function clearAll(): Promise<void> {
  await clearAllAt(directory())
  await clearAllAt(mcpDirectory())
}
