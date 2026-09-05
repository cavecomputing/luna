import { describe, expect, it } from 'vitest'
import type { McpEra } from '../../shared/mcp.js'
import { MODERN_VERSION } from '../mcp/client.js'
import { loopback, type Responder } from '../rpc/loopback.js'
import type { CloseReason, Transport } from '../rpc/transport.js'
import { builtinResponder } from './builtin.js'
import { Registry, builtinSource, type Source } from './registry.js'

function live(): AbortSignal {
  return new AbortController().signal
}

/**
 * Wraps a test responder in the era probe every server has to answer, so each
 * fixture below can be about the one behaviour it is testing. A server that
 * left this out would be treated as legacy and asked to `initialize`, which is
 * correct of the registry and not what these tests are for.
 */
function sourceOf(respond: Responder, id = 'test'): Source {
  const modern: Responder = (line, reply) => {
    const message = JSON.parse(line) as { id?: unknown; method?: string }
    if (message.method !== 'server/discover') {
      respond(line, reply)
      return
    }
    reply(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { resultType: 'complete', supportedVersions: [MODERN_VERSION] },
    }))
  }
  return { id, label: 'Test', open: () => Promise.resolve(loopback(modern)) }
}

async function ready(sources: readonly Source[] = [builtinSource()]): Promise<Registry> {
  const registry = new Registry(() => sources)
  await registry.discover(sources[0]?.id ?? 'builtin', live())
  return registry
}

describe('Registry', () => {
  it('discovers the built-in tool through the peer', async () => {
    const registry = await ready()
    const found = await registry.discover('builtin', live())

    expect(found.ok).toBe(true)
    if (found.ok) expect(found.value.map((tool) => tool.name)).toEqual(['luna_echo'])
  })

  it('reports an unknown source rather than throwing', async () => {
    const registry = new Registry(() => [builtinSource()])
    const found = await registry.discover('nope', live())

    expect(found.ok).toBe(false)
    if (!found.ok) expect(found.code).toBe('tool/no-source')
  })

  it('lists every source in one catalog', async () => {
    const registry = await ready()
    const catalog = await registry.catalog(live())
    expect(catalog.map((entry) => [entry.source, entry.definition.name])).toEqual([
      ['builtin', 'luna_echo'],
    ])
  })

  /** The whole point of the loopback transport: this is a real round trip. */
  it('calls a tool and reads its result', async () => {
    const registry = await ready()
    const outcome = await registry.call(
      'builtin',
      { callId: 'call-1', name: 'luna_echo', arguments: '{"text":"round trip"}' },
      live(),
    )

    expect(outcome.step.isError).toBe(false)
    expect(outcome.modelText).toBe('round trip')
  })

  describe('failures the model can recover from', () => {
    it('reports malformed argument JSON as a tool error', async () => {
      const registry = await ready()
      const outcome = await registry.call(
        'builtin',
        { callId: 'call-1', name: 'luna_echo', arguments: '{"text": ' },
        live(),
      )

      expect(outcome.step.isError).toBe(true)
      expect(outcome.modelText).toContain('valid JSON')
    })

    it('treats empty arguments as an empty object', async () => {
      const registry = await ready()
      const outcome = await registry.call(
        'builtin',
        { callId: 'call-1', name: 'luna_echo', arguments: '' },
        live(),
      )

      // The tool itself rejects the missing argument, which is a tool error.
      expect(outcome.step.isError).toBe(true)
      expect(outcome.modelText).toContain('required')
    })

    it('rejects valid JSON that is not an argument object before dispatch', async () => {
      const registry = await ready()
      const outcome = await registry.call(
        'builtin',
        { callId: 'call-1', name: 'luna_echo', arguments: 'null' },
        live(),
      )

      expect(outcome.step.isError).toBe(true)
      expect(outcome.modelText).toContain('JSON object')
    })

    it('names the available tools when the model invents one', async () => {
      const registry = await ready()
      const outcome = await registry.call(
        'builtin',
        { callId: 'call-1', name: 'not_a_tool', arguments: '{}' },
        live(),
      )

      expect(outcome.step.isError).toBe(true)
      expect(outcome.modelText).toContain('luna_echo')
    })

    it('reports a call to a source that was never connected', async () => {
      const registry = new Registry(() => [builtinSource()])
      const outcome = await registry.call(
        'builtin',
        { callId: 'call-1', name: 'luna_echo', arguments: '{}' },
        live(),
      )

      expect(outcome.step.isError).toBe(true)
      expect(outcome.modelText).toContain('not available')
    })

    it('reports a source that answers with a protocol error', async () => {
      const broken = sourceOf((line, reply) => {
        const message: Record<string, unknown> = JSON.parse(line) as Record<string, unknown>
        if (message.method === 'tools/list') {
          reply(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [{ name: 'boom', description: '', inputSchema: { type: 'object' } }],
            },
          }))
          return
        }
        reply(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: 'internal' },
        }))
      })
      const registry = await ready([broken])

      const outcome = await registry.call(
        'test',
        { callId: 'call-1', name: 'boom', arguments: '{}' },
        live(),
      )
      expect(outcome.step.isError).toBe(true)
      expect(outcome.modelText).toContain('did not complete')
    })
  })

  it('carries cancellation into the call', async () => {
    const silent = sourceOf((line, reply) => {
      const message: Record<string, unknown> = JSON.parse(line) as Record<string, unknown>
      if (message.method === 'tools/list') {
        reply(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: [{ name: 'slow', description: '', inputSchema: { type: 'object' } }] },
        }))
      }
      // A tools/call is deliberately never answered.
    })
    const registry = await ready([silent])
    const controller = new AbortController()

    const pending = registry.call(
      'test',
      { callId: 'call-1', name: 'slow', arguments: '{}' },
      controller.signal,
    )
    controller.abort()

    const outcome = await pending
    expect(outcome.step.isError).toBe(true)
    expect(outcome.modelText).toContain('rpc/cancelled')
  })

  /**
   * The signal handed to discover() belongs to the turn that wanted a tool. It
   * must cancel the startup and nothing after it: a cancelled turn is a normal
   * thing to do, and it cannot be allowed to take a live server down with it.
   */
  it('keeps a source usable after the turn that discovered it is cancelled', async () => {
    const registry = new Registry(() => [builtinSource()])
    const controller = new AbortController()
    await registry.discover('builtin', controller.signal)
    controller.abort()

    const outcome = await registry.call(
      'builtin',
      { callId: 'call-1', name: 'luna_echo', arguments: '{"text":"still here"}' },
      live(),
    )
    expect(outcome.step.isError).toBe(false)
    expect(outcome.modelText).toBe('still here')
  })

  /**
   * Two turns can want a tool at the same moment, and a server is a process.
   * Starting it twice would leave a second `npx` on the user's machine writing
   * into a pipe nobody reads.
   */
  it('starts a source once when two callers ask at the same time', async () => {
    let opened = 0
    const source: Source = {
      ...sourceOf(builtinResponder()),
      open: () => {
        opened += 1
        return Promise.resolve(loopback(builtinResponder()))
      },
    }
    const registry = new Registry(() => [source])

    const [first, second] = await Promise.all([
      registry.discover('test', live()),
      registry.discover('test', live()),
    ])

    expect(opened).toBe(1)
    expect(first?.ok).toBe(true)
    expect(second?.ok).toBe(true)
  })

  it('reports missing credentials when a source cannot be opened', async () => {
    const source: Source = {
      ...sourceOf(builtinResponder()),
      open: () => Promise.reject(new Error('keychain refused')),
    }
    const registry = new Registry(() => [source])

    const found = await registry.discover('test', live())
    expect(found.ok).toBe(false)
    if (!found.ok) expect(found.code).toBe('tool/no-credentials')
    expect(registry.states().get('test')).toMatchObject({
      status: 'failed',
      errorCode: 'tool/no-credentials',
    })
  })

  /**
   * A server that hangs costs the full discovery deadline. Paying that on every
   * turn would make the whole app feel broken because one server is.
   */
  it('does not retry a failed source until its cooldown expires', async () => {
    let opened = 0
    const source: Source = {
      ...sourceOf(builtinResponder()),
      open: () => {
        opened += 1
        return Promise.reject(new Error('nope'))
      },
    }
    let clock = 1_000
    const registry = new Registry(() => [source], {
      now: () => clock,
      cooldownMs: 60_000,
    })

    await registry.discover('test', live())
    const second = await registry.discover('test', live())
    expect(opened).toBe(1)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('tool/cooling-down')

    clock += 60_001
    await registry.discover('test', live())
    expect(opened).toBe(2)
  })

  it('lets a restarted source be tried again immediately', async () => {
    let opened = 0
    const source: Source = {
      ...sourceOf(builtinResponder()),
      open: () => {
        opened += 1
        return Promise.reject(new Error('nope'))
      },
    }
    const registry = new Registry(() => [source], { now: () => 1_000 })

    await registry.discover('test', live())
    await registry.restart('test')
    await registry.discover('test', live())

    expect(opened).toBe(2)
    expect(registry.states().get('test')).toEqual({ status: 'failed', toolCount: 0, errorCode: 'tool/no-credentials' })
  })

  /**
   * A cached connection to a process that has already died is worse than none:
   * every call against it fails in a way that looks like a broken tool rather
   * than a stopped server.
   */
  it('drops a source whose channel closes underneath it', async () => {
    let closed: ((reason: CloseReason) => void) | undefined
    const source: Source = {
      ...sourceOf(builtinResponder()),
      open: () => {
        const inner = loopback(builtinResponder())
        const wrapped: Transport = {
          ...inner,
          onClose: (fn) => {
            closed = fn
            inner.onClose(fn)
          },
        }
        return Promise.resolve(wrapped)
      },
    }
    const registry = new Registry(() => [source])

    await registry.discover('test', live())
    expect(registry.states().get('test')?.status).toBe('ready')

    closed?.({ kind: 'exit', code: 1 })
    expect(registry.states().get('test')).toEqual({ status: 'idle', toolCount: 0 })

    const outcome = await registry.call(
      'test',
      { callId: 'call-1', name: 'luna_echo', arguments: '{}' },
      live(),
    )
    expect(outcome.step.isError).toBe(true)
  })

  it('records the era a handshake settled on', async () => {
    const remembered: (McpEra | null)[] = []
    const source: Source = {
      ...sourceOf(builtinResponder()),
      remember: (era) => remembered.push(era),
    }
    const registry = new Registry(() => [source])

    await registry.discover('test', live())
    expect(remembered).toEqual(['modern'])
  })

  /**
   * A remembered era is a shortcut past the probe. When the shortcut leads
   * somewhere that does not answer, it has to be thrown away — otherwise the
   * server is permanently unreachable through a stale verdict.
   */
  it('clears a cached era that no longer works', async () => {
    const remembered: (McpEra | null)[] = []
    const silent: Responder = () => undefined
    const source: Source = {
      id: 'test',
      label: 'Test',
      era: 'legacy',
      remember: (era) => remembered.push(era),
      open: () => Promise.resolve(loopback(silent)),
    }
    const registry = new Registry(() => [source], { discoverMs: 25 })

    const found = await registry.discover('test', live())
    expect(found.ok).toBe(false)
    expect(remembered).toEqual([null])
  })

  /**
   * Serially, one slow server would hold up every other server's tools, and the
   * first turn after launch would cost the sum of every startup.
   */
  it('keeps cataloguing when one source cannot start', async () => {
    const broken: Source = {
      id: 'broken',
      label: 'Broken',
      open: () => Promise.reject(new Error('nope')),
    }
    const registry = new Registry(() => [builtinSource(), broken])

    const catalog = await registry.catalog(live())
    expect(catalog.map((entry) => entry.source)).toEqual(['builtin'])
  })

  it('forgets a source so a changed definition is not reused', async () => {
    const registry = await ready()
    await registry.forget('builtin')

    expect(registry.states().get('builtin')).toEqual({ status: 'idle', toolCount: 0 })
    const outcome = await registry.call(
      'builtin',
      { callId: 'call-1', name: 'luna_echo', arguments: '{}' },
      live(),
    )
    expect(outcome.step.isError).toBe(true)
  })

  it('closes every connection when stopped', async () => {
    const registry = await ready()
    await registry.stopAll()

    const outcome = await registry.call(
      'builtin',
      { callId: 'call-1', name: 'luna_echo', arguments: '{}' },
      live(),
    )
    expect(outcome.modelText).toContain('not available')
  })
})

describe('builtinResponder', () => {
  it('rejects an unknown method with a protocol error', () => {
    const respond = builtinResponder()
    let answer = ''
    respond(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list' }), (line) => {
      answer = line
    })
    expect(JSON.parse(answer)).toMatchObject({ error: { code: -32601 } })
  })

  it('ignores a notification', () => {
    const respond = builtinResponder()
    let answered = false
    respond(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled' }), () => {
      answered = true
    })
    expect(answered).toBe(false)
  })
})
