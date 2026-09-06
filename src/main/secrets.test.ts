import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearAllAt, clearAt, hasAt, readAt, readEnvAt, writeAt, writeEnvAt } from './secrets.js'

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

describe('MCP server environments', () => {
  const env = { GITHUB_TOKEN: 'test-token', REGION: 'eu-west-1' }

  it('persists only encrypted bytes and decrypts them in main', async () => {
    const dir = await temp()
    await writeEnvAt(dir, 'server-1', env, cipher)

    const raw = await readFile(join(dir, 'server-1.key'), 'utf8')
    expect(raw.includes('test-token')).toBe(false)
    expect(await readEnvAt(dir, 'server-1', cipher)).toEqual(env)
  })

  it('reports nothing for a server with no stored environment', async () => {
    const dir = await temp()
    expect(await readEnvAt(dir, 'server-1', cipher)).toBeUndefined()
  })

  it('replaces the whole set rather than merging into it', async () => {
    const dir = await temp()
    await writeEnvAt(dir, 'server-1', env, cipher)
    await writeEnvAt(dir, 'server-1', { REGION: 'us-east-1' }, cipher)

    // A removed variable must actually be gone; merging would leave a token
    // reachable by a server the user had already taken it away from.
    expect(await readEnvAt(dir, 'server-1', cipher)).toEqual({ REGION: 'us-east-1' })
  })

  it('refuses a variable name that is not one', async () => {
    const dir = await temp()
    await expect(writeEnvAt(dir, 'server-1', { 'HAS SPACE': 'x' }, cipher)).rejects.toThrow(
      /invalid/,
    )
  })

  it('refuses a value past the bound', async () => {
    const dir = await temp()
    await expect(
      writeEnvAt(dir, 'server-1', { TOKEN: 'x'.repeat(8_193) }, cipher),
    ).rejects.toThrow(/invalid/)
  })

  /**
   * Whole-or-nothing. A server started with half its variables fails in a way
   * that looks like a bad token rather than a missing one.
   */
  it('reports nothing when the stored blob is not what we wrote', async () => {
    const dir = await temp()
    await writeAt(dir, 'server-1', 'not json', cipher)
    expect(await readEnvAt(dir, 'server-1', cipher)).toBeUndefined()

    await writeAt(dir, 'server-2', JSON.stringify({ 'HAS SPACE': 'x' }), cipher)
    expect(await readEnvAt(dir, 'server-2', cipher)).toBeUndefined()

    await writeAt(dir, 'server-3', JSON.stringify({ TOKEN: 42 }), cipher)
    expect(await readEnvAt(dir, 'server-3', cipher)).toBeUndefined()
  })

  it('rejects a server id that could escape the secret directory', async () => {
    const dir = await temp()
    await expect(writeEnvAt(dir, '../escape', env, cipher)).rejects.toThrow(/invalid/)
  })
})
