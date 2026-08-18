import { describe, expect, it, vi } from 'vitest'
import { JsonRpcPeer } from './jsonrpc.js'

type Sent = Record<string, unknown>

function makePeer(timeoutMs = 30_000): { peer: JsonRpcPeer; sent: Sent[] } {
  const sent: Sent[] = []
  const peer = new JsonRpcPeer((line) => {
    sent.push(JSON.parse(line) as Sent)
  }, { timeoutMs })
  return { peer, sent }
}

function reply(peer: JsonRpcPeer, id: number, result: unknown): void {
  peer.receive({ jsonrpc: '2.0', id, result })
}

describe('JsonRpcPeer', () => {
  it('returns a typed failure when writing to the transport throws', async () => {
    const peer = new JsonRpcPeer(() => {
      throw new Error('broken pipe')
    })

    await expect(peer.request('tools/list', {})).resolves.toMatchObject({
      ok: false,
      code: 'rpc/write',
    })
  })

  it('does not throw when a best-effort notification cannot be written', () => {
    const peer = new JsonRpcPeer(() => {
      throw new Error('broken pipe')
    })
    expect(() => {
      peer.notify('notifications/progress', {})
    }).not.toThrow()
  })

  it('resolves a request with the result carrying its id', async () => {
    const { peer, sent } = makePeer()
    const pending = peer.request('tools/list', {})
    expect(sent[0]).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    reply(peer, 1, { tools: [] })

    expect(await pending).toEqual({ ok: true, value: { tools: [] } })
  })

  /**
   * All replies share one channel, so nothing guarantees they come back in the
   * order they were sent. Correlation is by id and only by id.
   */
  it('resolves concurrent requests correctly when replies arrive out of order', async () => {
    const { peer } = makePeer()
    const first = peer.request('a', {})
    const second = peer.request('b', {})
    const third = peer.request('c', {})

    reply(peer, 3, 'third')
    reply(peer, 1, 'first')
    reply(peer, 2, 'second')

    expect(await first).toEqual({ ok: true, value: 'first' })
    expect(await second).toEqual({ ok: true, value: 'second' })
    expect(await third).toEqual({ ok: true, value: 'third' })
  })

  it('reports a peer error response as a failure', async () => {
    const { peer } = makePeer()
    const pending = peer.request('tools/call', {})
    peer.receive({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no such method' } })

    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('rpc/error')
  })

  it('ignores a response whose id matches nothing', () => {
    const { peer } = makePeer()
    expect(() => {
      reply(peer, 99, 'nobody asked')
    }).not.toThrow()
  })

  it('routes notifications to the handler and never resolves a request with one', async () => {
    const { peer } = makePeer()
    const seen = vi.fn()
    peer.onNotification(seen)
    const pending = peer.request('slow', {})

    peer.receive({ jsonrpc: '2.0', method: 'notifications/progress', params: { done: 1 } })
    expect(seen).toHaveBeenCalledWith('notifications/progress', { done: 1 })

    reply(peer, 1, 'finally')
    expect(await pending).toEqual({ ok: true, value: 'finally' })
  })

  /**
   * The far side is not allowed to open a request on this channel. Answering
   * would mean writing a response back up a stream that must not carry one, so
   * the violation is counted and dropped.
   */
  it('drops an inbound request instead of answering it', () => {
    const { peer, sent } = makePeer()
    const seen = vi.fn()
    peer.onNotification(seen)

    peer.receive({ jsonrpc: '2.0', id: 7, method: 'sampling/createMessage', params: {} })

    expect(peer.unexpectedRequests).toBe(1)
    expect(seen).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('survives a malformed inbound message', async () => {
    const { peer } = makePeer()
    const pending = peer.request('a', {})
    peer.receive('not an object')
    peer.receive(null)
    peer.receive({ jsonrpc: '2.0' })

    reply(peer, 1, 'still works')
    expect(await pending).toEqual({ ok: true, value: 'still works' })
  })

  describe('cancellation', () => {
    it('tells the peer to stop, not just the caller', async () => {
      const { peer, sent } = makePeer()
      const controller = new AbortController()
      const pending = peer.request('slow', {}, controller.signal)

      controller.abort()

      const result = await pending
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('rpc/cancelled')
      expect(sent[1]).toEqual({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 1 },
      })
    })

    it('discards a response that arrives after cancellation', async () => {
      const { peer } = makePeer()
      const controller = new AbortController()
      const pending = peer.request('slow', {}, controller.signal)
      controller.abort()
      await pending

      expect(() => {
        reply(peer, 1, 'too late')
      }).not.toThrow()
    })

    it('refuses a request whose signal is already aborted', async () => {
      const { peer, sent } = makePeer()
      const result = await peer.request('a', {}, AbortSignal.abort())

      expect(result.ok).toBe(false)
      expect(sent).toEqual([])
    })
  })

  describe('deadlines', () => {
    it('fails a request that outlives its timeout and cancels it on the wire', async () => {
      vi.useFakeTimers()
      try {
        const { peer, sent } = makePeer(1_000)
        const pending = peer.request('slow', {})
        vi.advanceTimersByTime(1_001)

        const result = await pending
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.code).toBe('rpc/timeout')
        expect(sent[1]).toMatchObject({ method: 'notifications/cancelled' })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('close', () => {
    /** A dead peer must surface as an error, never as a caller that never wakes. */
    it('fails every request still waiting', async () => {
      const { peer } = makePeer()
      const first = peer.request('a', {})
      const second = peer.request('b', {})

      peer.close('peer exited')

      for (const pending of [first, second]) {
        const result = await pending
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.code).toBe('rpc/closed')
      }
    })

    it('refuses new requests once closed', async () => {
      const { peer, sent } = makePeer()
      peer.close()

      const result = await peer.request('a', {})
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('rpc/closed')
      expect(sent).toEqual([])
    })

    it('drops notifications sent after close', () => {
      const { peer, sent } = makePeer()
      peer.close()
      peer.notify('anything')
      expect(sent).toEqual([])
    })
  })

  /**
   * The raw surface `request` is built on. MCP needs it: a server's era is
   * decided from the peer's own error code and `data`, which the `Result` form
   * deliberately flattens away.
   */
  describe('call', () => {
    it('keeps the peer error code and data intact', async () => {
      const { peer } = makePeer()
      const pending = peer.call('server/discover', {})
      peer.receive({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32022,
          message: 'Unsupported protocol version',
          data: { supported: ['2026-07-28', '2025-11-25'], requested: '1900-01-01' },
        },
      })

      expect(await pending).toEqual({
        kind: 'error',
        code: -32022,
        message: 'Unsupported protocol version',
        data: { supported: ['2026-07-28', '2025-11-25'], requested: '1900-01-01' },
      })
    })

    it('substitutes a code and message for an error missing them', async () => {
      const { peer } = makePeer()
      const pending = peer.call('a', {})
      peer.receive({ jsonrpc: '2.0', id: 1, error: { code: 'nope' } })

      expect(await pending).toEqual({ kind: 'error', code: 0, message: '', data: undefined })
    })

    it('reports a result as ok', async () => {
      const { peer } = makePeer()
      const pending = peer.call('tools/list', {})
      reply(peer, 1, { tools: [] })

      expect(await pending).toEqual({ kind: 'ok', value: { tools: [] } })
    })

    /**
     * A local timeout must never look like a peer error, or a caller branching
     * on an error code would read one out of a message the peer never sent.
     */
    it('distinguishes a local timeout from a peer error', async () => {
      vi.useFakeTimers()
      try {
        const { peer } = makePeer(1_000)
        const pending = peer.call('slow', {})
        vi.advanceTimersByTime(1_001)

        expect(await pending).toEqual({ kind: 'timeout' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('reports cancellation, closure, and an unwritable channel apart', async () => {
      const { peer } = makePeer()
      const controller = new AbortController()
      const cancelled = peer.call('a', {}, controller.signal)
      controller.abort()
      expect(await cancelled).toEqual({ kind: 'cancelled' })

      const pending = peer.call('b', {})
      peer.close('peer exited')
      expect(await pending).toEqual({ kind: 'closed', reason: 'peer exited' })
      expect(await peer.call('c', {})).toEqual({ kind: 'closed', reason: 'peer is closed' })

      const broken = new JsonRpcPeer(() => {
        throw new Error('broken pipe')
      })
      expect(await broken.call('d', {})).toEqual({ kind: 'write' })
    })
  })

})
