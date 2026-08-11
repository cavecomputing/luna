import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { id } from './parse.js'

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

export function directory(): string {
  return join(app.getPath('userData'), 'provider-keys')
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
