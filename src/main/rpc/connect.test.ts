import { describe, expect, it } from 'vitest'
import { connect } from './connect.js'
import { loopback } from './loopback.js'
import type { CloseReason, Transport } from './transport.js'

/** Answers every request with the method name echoed back. */
function echoResponder(line: string, reply: (line: string) => void): void {
  const message: Record<string, unknown> = JSON.parse(line) as Record<string, unknown>
  if (message.id === undefined) return
  reply(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { saw: message.method } }))
}

/** A transport whose received bytes the test drives by hand. */
function manual(): { transport: Transport; feed: (chunk: string) => void; end: () => void } {
  let data: ((chunk: string) => void) | undefined
  let close: ((reason: CloseReason) => void) | undefined
  return {
    transport: {
      start: () => Promise.resolve({ ok: true, value: undefined }),
      send: () => undefined,
      onData: (fn) => {
        data = fn
      },
      onClose: (fn) => {
        close = fn
      },
      stop: () => Promise.resolve(),
    },
    feed: (chunk) => data?.(chunk),
    end: () => close?.({ kind: 'exit', code: 0 }),
  }
}

describe('connect', () => {
  it('carries a request and its reply over a transport', async () => {
    const connection = connect(loopback(echoResponder))
    await connection.start(new AbortController().signal)

    expect(await connection.peer.request('tools/list', {})).toEqual({
      ok: true,
      value: { saw: 'tools/list' },
    })
  })

  it('frames a reply delivered in fragments', async () => {
    const { transport, feed } = manual()
    const connection = connect(transport)
    await connection.start(new AbortController().signal)
    const pending = connection.peer.request('tools/list', {})

    feed('{"jsonrpc":"2.0","id":1,"res')
    feed('ult":{"tools":[]}}')
    feed('\n')

    expect(await pending).toEqual({ ok: true, value: { tools: [] } })
  })

  it('fails pending requests when the channel closes underneath them', async () => {
    const { transport, end } = manual()
    const connection = connect(transport)
    await connection.start(new AbortController().signal)
    const pending = connection.peer.request('slow', {})

    end()

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('rpc/closed')
  })

  /** A close can race a final reply that was already on the wire. */
  it('delivers a trailing unterminated message before failing the rest', async () => {
    const { transport, feed, end } = manual()
    const connection = connect(transport)
    await connection.start(new AbortController().signal)
    const first = connection.peer.request('a', {})
    const second = connection.peer.request('b', {})

    feed('{"jsonrpc":"2.0","id":1,"result":"made it"}')
    end()

    expect(await first).toEqual({ ok: true, value: 'made it' })
    expect((await second).ok).toBe(false)
  })

  it('keeps working after an undecodable line', async () => {
    const { transport, feed } = manual()
    const connection = connect(transport)
    await connection.start(new AbortController().signal)
    const pending = connection.peer.request('a', {})

    feed('garbage that is not json\n')
    feed('{"jsonrpc":"2.0","id":1,"result":"fine"}\n')

    expect(await pending).toEqual({ ok: true, value: 'fine' })
  })

  it('closes the peer when stopped', async () => {
    const connection = connect(loopback(echoResponder))
    await connection.start(new AbortController().signal)
    await connection.stop(0)

    const result = await connection.peer.request('tools/list', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('rpc/closed')
  })

  /**
   * The signal passed to start() cancels the startup and nothing after it. It
   * belongs to whoever wanted the channel — a turn, usually — and a turn ending
   * is ordinary. Closing the connection on it would mean cancelling one reply
   * silently took every tool down until the app restarted.
   */
  it('keeps the connection alive when the start signal is aborted later', async () => {
    const controller = new AbortController()
    const connection = connect(loopback(echoResponder), { timeoutMs: 50 })
    await connection.start(controller.signal)

    controller.abort()

    expect(await connection.peer.request('tools/list', {})).toMatchObject({ ok: true })
    await connection.stop(0)
  })
})
