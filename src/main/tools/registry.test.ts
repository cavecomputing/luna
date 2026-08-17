import { describe, expect, it } from 'vitest'
import { loopback, type Responder } from '../rpc/loopback.js'
import { builtinResponder } from './builtin.js'
import { Registry, builtinSource, readTools, type Source } from './registry.js'

function live(): AbortSignal {
  return new AbortController().signal
}

function sourceOf(respond: Responder, id = 'test'): Source {
  return { id, label: 'Test', open: () => loopback(respond) }
}

async function ready(sources: readonly Source[] = [builtinSource()]): Promise<Registry> {
  const registry = new Registry(sources)
  await registry.discover(sources[0]?.id ?? 'builtin', live())
  return registry
}

describe('readTools', () => {
  it('parses a well-formed tool', () => {
    expect(
      readTools({
        tools: [{
          name: 'get_weather',
          title: 'Weather',
          description: 'Gets weather.',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true, openWorldHint: true },
        }],
      }),
    ).toEqual([{
      name: 'get_weather',
      title: 'Weather',
      description: 'Gets weather.',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, openWorldHint: true },
    }])
  })

  /** Names the protocol allows but Luna's own id shape would have rejected. */
  it('accepts a dotted tool name', () => {
    const tools = readTools({
      tools: [{ name: 'admin.tools.list', description: '', inputSchema: { type: 'object' } }],
    })
    expect(tools[0]?.name).toBe('admin.tools.list')
  })

  it('drops a tool with an unusable name or no schema', () => {
    expect(
      readTools({
        tools: [
          { name: 'has space', description: '', inputSchema: { type: 'object' } },
          { name: 'no_schema', description: '' },
          { name: 'array_schema', description: '', inputSchema: [] },
          { name: 'fine', description: '', inputSchema: { type: 'object' } },
        ],
      }).map((tool) => tool.name),
    ).toEqual(['fine'])
  })

  it('keeps only boolean annotation hints', () => {
    const tools = readTools({
      tools: [{
        name: 'x',
        description: '',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: 'yes', destructiveHint: true },
      }],
    })
    expect(tools[0]?.annotations).toEqual({ destructiveHint: true })
  })

  it('returns nothing for a malformed reply', () => {
    expect(readTools(undefined)).toEqual([])
    expect(readTools({ tools: 'lots' })).toEqual([])
  })
})

describe('Registry', () => {
  it('discovers the built-in tool through the peer', async () => {
    const registry = await ready()
    const found = await registry.discover('builtin', live())

    expect(found.ok).toBe(true)
    if (found.ok) expect(found.value.map((tool) => tool.name)).toEqual(['luna_echo'])
  })

  it('reports an unknown source rather than throwing', async () => {
    const registry = new Registry([builtinSource()])
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
      const registry = new Registry([builtinSource()])
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
