import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { connect } from './connect.js'
import { baseEnv, child, type ChildSpec, type SpawnDeps } from './child.js'
import type { CloseReason } from './transport.js'

/**
 * Real subprocesses, deliberately.
 *
 * The whole point of this file is the boundary between us and a program we did
 * not write — pipe buffers, exit ordering, signal handling. A mocked
 * `child_process` would assert that the mock behaves the way I assumed, which
 * is the assumption most likely to be wrong. These run `node -e` instead: no
 * network, no fixtures on disk, and deterministic.
 */
function deps(): SpawnDeps {
  return { spawn, platform: process.platform, parentEnv: process.env, isFile: () => false }
}

function script(source: string, extra: Partial<ChildSpec> = {}): ChildSpec {
  return { command: process.execPath, args: ['-e', source], env: {}, ...extra }
}

function live(): AbortSignal {
  return new AbortController().signal
}

/** Reads whole lines from stdin and answers each one. */
const SERVER = `
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      const message = JSON.parse(line)
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { echo: message.params } }) + '\\n')
    }
  })
  process.stdin.on('end', () => process.exit(0))
`

describe('baseEnv', () => {
  it('passes through only the allowlisted variables', () => {
    const parent = { PATH: '/usr/bin', HOME: '/home/x', OPENAI_API_KEY: 'test-should-not-travel' }
    expect(baseEnv('darwin', parent)).toEqual({ PATH: '/usr/bin', HOME: '/home/x' })
  })

  it('uses the Windows set on Windows', () => {
    const parent = { PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', HOME: '/home/x' }
    expect(baseEnv('win32', parent)).toEqual({ PATH: 'C:\\bin', SystemRoot: 'C:\\Windows' })
  })

  it('omits a variable the parent does not have rather than passing undefined', () => {
    expect(Object.keys(baseEnv('darwin', {}))).toEqual([])
  })
})

describe('child', () => {
  it('round-trips a request through a real process', async () => {
    const connection = connect(child(script(SERVER), deps()))
    const started = await connection.start(live())
    expect(started.ok).toBe(true)

    const replied = await connection.peer.request('ping', { n: 1 }, live())
    expect(replied).toEqual({ ok: true, value: { echo: { n: 1 } } })

    await connection.stop(2_000)
  })

  /**
   * A pipe hands over whatever it has, which has nothing to do with where a
   * message ends. The framer above us is what makes this work; this proves the
   * transport does not quietly undo it by re-chunking or re-encoding.
   */
  it('reassembles a reply written in pieces', async () => {
    const dribble = `
      process.stdin.resume()
      const reply = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }) + '\\n'
      let i = 0
      const timer = setInterval(() => {
        process.stdout.write(reply[i])
        i += 1
        if (i === reply.length) { clearInterval(timer) }
      }, 1)
    `
    const connection = connect(child(script(dribble), deps()))
    await connection.start(live())

    expect(await connection.peer.request('ping', {}, live())).toEqual({
      ok: true,
      value: { ok: true },
    })
    await connection.stop(2_000)
  })

  it('splits two messages that arrive in one chunk', async () => {
    const both = `
      process.stdin.resume()
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'one' }) + '\\n' +
        JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'two' }) + '\\n'
      )
    `
    const connection = connect(child(script(both), deps()))
    await connection.start(live())

    const first = connection.peer.request('a', {}, live())
    const second = connection.peer.request('b', {}, live())
    expect(await first).toEqual({ ok: true, value: 'one' })
    expect(await second).toEqual({ ok: true, value: 'two' })

    await connection.stop(2_000)
  })

  /**
   * An unread stderr pipe fills at about 64KB and the child then blocks on its
   * next write — forever, and with no error anywhere. This is the test that
   * fails if the `resume()` in child.ts is ever removed as dead code.
   */
  it('keeps answering after the server floods stderr', async () => {
    const noisy = `
      process.stderr.write('x'.repeat(512 * 1024))
      process.stdin.resume()
      process.stdin.on('data', () => {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'alive' }) + '\\n')
      })
    `
    const connection = connect(child(script(noisy), deps()))
    await connection.start(live())

    expect(await connection.peer.request('ping', {}, live())).toEqual({
      ok: true,
      value: 'alive',
    })
    await connection.stop(2_000)
  })

  it('reports a command that does not exist', async () => {
    const transport = child({ command: 'luna-no-such-binary', args: [], env: {} }, deps())
    const started = await transport.start(live())

    expect(started.ok).toBe(false)
    if (!started.ok) expect(started.code).toBe('rpc/spawn')
  })

  it('refuses an argument carrying a NUL rather than letting spawn throw', async () => {
    const transport = child(script('process.exit(0)', { args: ['-e', 'x\0y'] }), deps())
    const started = await transport.start(live())

    expect(started.ok).toBe(false)
    if (!started.ok) expect(started.code).toBe('rpc/spawn')
  })

  /**
   * Starting means the channel is up, not that the server is well. A program
   * that launches and immediately quits started successfully and then died, and
   * the close is what says so — the same shape as a server that dies an hour in.
   */
  it('starts a server that immediately quits, then reports its exit', async () => {
    const transport = child(script('process.exit(3)'), deps())
    const reasons: CloseReason[] = []
    transport.onClose((reason) => reasons.push(reason))

    expect(await transport.start(live())).toEqual({ ok: true, value: undefined })
    await new Promise((settle) => setTimeout(settle, 200))
    expect(reasons).toEqual([{ kind: 'exit', code: 3 }])
  })

  it('passes the configured variables and withholds Luna’s own', async () => {
    const print = `
      process.stdin.resume()
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { token: process.env.SERVER_TOKEN ?? null, leaked: process.env.LUNA_SECRET ?? null },
      }) + '\\n')
    `
    const withSecret = { ...deps(), parentEnv: { ...process.env, LUNA_SECRET: 'test-secret' } }
    const connection = connect(
      child(script(print, { env: { SERVER_TOKEN: 'test-token' } }), withSecret),
    )
    await connection.start(live())

    expect(await connection.peer.request('env', {}, live())).toEqual({
      ok: true,
      value: { token: 'test-token', leaked: null },
    })
    await connection.stop(2_000)
  })

  describe('stop', () => {
    it('exits a well-behaved server by closing its input', async () => {
      const transport = child(script(SERVER), deps())
      const reasons: CloseReason[] = []
      transport.onClose((reason) => reasons.push(reason))
      await transport.start(live())

      const began = Date.now()
      await transport.stop(4_000)

      // It left on EOF, so nothing had to be signalled and nothing waited for
      // the first escalation deadline.
      expect(reasons[0]).toEqual({ kind: 'exit', code: 0 })
      expect(Date.now() - began).toBeLessThan(2_000)
    })

    it('kills a server that ignores both EOF and SIGTERM', async () => {
      const stubborn = `
        process.on('SIGTERM', () => {})
        process.stdin.resume()
        setInterval(() => {}, 1000)
      `
      const transport = child(script(stubborn), deps())
      const reasons: CloseReason[] = []
      transport.onClose((reason) => reasons.push(reason))
      await transport.start(live())

      await transport.stop(600)

      expect(reasons).toHaveLength(1)
      expect(reasons[0]?.kind).toBe('exit')
    })

    it('announces a close exactly once however the process ended', async () => {
      const transport = child(script(SERVER), deps())
      const reasons: CloseReason[] = []
      transport.onClose((reason) => reasons.push(reason))
      await transport.start(live())

      await transport.stop(2_000)
      await transport.stop(2_000)

      expect(reasons).toHaveLength(1)
    })

    it('is safe on a transport that was never started', async () => {
      const transport = child(script(SERVER), deps())
      const reasons: CloseReason[] = []
      transport.onClose((reason) => reasons.push(reason))

      await transport.stop(100)
      expect(reasons).toEqual([{ kind: 'stopped' }])
    })
  })

  /**
   * The peer must learn a server is gone, or every caller waiting on it hangs.
   * connect() turns the close into rpc/closed for exactly that reason.
   */
  it('fails a request still waiting when the server exits', async () => {
    const quitter = `
      process.stdin.resume()
      process.stdin.on('data', () => process.exit(1))
    `
    const connection = connect(child(script(quitter), deps()))
    await connection.start(live())

    const result = await connection.peer.request('ping', {}, live())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('rpc/closed')
  })
})
