import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearAllAt, clearAt, hasAt, readAt, writeAt } from './secrets.js'

const dirs: string[] = []

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'luna-secrets-'))
  dirs.push(dir)
  return dir
}

const cipher = {
  available: () => true,
  encrypt: (value: string) =>
    Buffer.from(Buffer.from(value, 'utf8').toString('base64url'), 'utf8'),
  decrypt: (value: Buffer) => Buffer.from(value.toString('utf8'), 'base64url').toString('utf8'),
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('provider secrets', () => {
  it('persists only encrypted bytes and decrypts them in main', async () => {
    const dir = await temp()
    await writeAt(dir, 'example', 'test-secret', cipher)

    expect((await readFile(join(dir, 'example.key'), 'utf8')).includes('test-secret')).toBe(false)
    expect(await readAt(dir, 'example', cipher)).toBe('test-secret')
  })

  it('reports whether a key exists without revealing it', async () => {
    const dir = await temp()
    expect(await hasAt(dir, 'example')).toBe(false)
    await writeAt(dir, 'example', 'test-secret', cipher)
    expect(await hasAt(dir, 'example')).toBe(true)
  })

  it('removes a stored key', async () => {
    const dir = await temp()
    await writeAt(dir, 'example', 'test-secret', cipher)
    await clearAt(dir, 'example')

    await expect(stat(join(dir, 'example.key'))).rejects.toThrow()
  })

  it('refuses to persist when platform encryption is unavailable', async () => {
    const dir = await temp()
    await expect(
      writeAt(dir, 'example', 'test-secret', { ...cipher, available: () => false }),
    ).rejects.toThrow(/unavailable/)
  })

  it('rejects provider ids that could escape the secret directory', async () => {
    const dir = await temp()
    await expect(writeAt(dir, '../escape', 'test-secret', cipher)).rejects.toThrow(/invalid/)
  })

  it('removes every stored key at once, orphans included', async () => {
    const dir = await temp()
    await writeAt(dir, 'example', 'test-secret', cipher)
    await writeAt(dir, 'second', 'test-secret', cipher)
    // An orphan a per-provider loop would miss, because no provider names it.
    await writeFile(join(dir, 'forgotten.key'), 'test-leftover')

    await clearAllAt(dir)

    await expect(stat(dir)).rejects.toThrow()
  })
})
