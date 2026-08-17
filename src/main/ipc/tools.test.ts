import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../../shared/tools.js'
import { toolKey } from '../../shared/tools.js'
import type { Grant } from '../tool-grants.js'
import { listTools, requireApproval, setEnabled } from './tools.js'

/** The deps argument is optional in production, so strip the undefined here. */
type TestDeps = NonNullable<Parameters<typeof listTools>[0]>

const weather: ToolDefinition = {
  name: 'get_weather',
  description: 'Gets weather.',
  inputSchema: { type: 'object' },
}

function grantOf(over: Partial<Grant> = {}): Grant {
  return {
    source: 'server-1',
    toolName: 'get_weather',
    enabled: false,
    policy: 'ask',
    digest: 'digest-1',
    seenAt: 100,
    ...over,
  }
}

function makeDeps(over: Partial<TestDeps> = {}): TestDeps {
  const stored = new Map<string, Grant>()
  return {
    catalog: vi.fn().mockResolvedValue([{ source: 'server-1', definition: weather }]),
    labelOf: vi.fn().mockReturnValue('Server One'),
    loadGrants: vi.fn(() => stored),
    reconcile: vi.fn((source: string, definitions: readonly ToolDefinition[]) => {
      for (const definition of definitions) {
        const key = toolKey(source, definition.name)
        if (!stored.has(key)) stored.set(key, grantOf({ toolName: definition.name }))
      }
    }),
    setEnabled: vi.fn((source: string, name: string, enabled: boolean) => {
      const found = stored.get(toolKey(source, name))
      if (found === undefined) return undefined
      const next: Grant = {
        ...found,
        enabled,
        policy: enabled ? found.policy : ('ask' as const),
      }
      if (enabled) next.approvedAt = 200
      else delete next.approvedAt
      stored.set(toolKey(source, name), next)
      return next
    }),
    setPolicy: vi.fn((source: string, name: string, policy: 'ask' | 'allow') => {
      const found = stored.get(toolKey(source, name))
      if (found === undefined) return undefined
      const next = { ...found, policy, approvedAt: 200 }
      stored.set(toolKey(source, name), next)
      return next
    }),
    now: () => 200,
    notifyTools: vi.fn(),
    ...over,
  }
}

describe('listTools', () => {
  it('reports a discovered tool as disabled until someone approves it', async () => {
    const result = await listTools(makeDeps())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([
      expect.objectContaining({
        source: 'server-1',
        sourceLabel: 'Server One',
        enabled: false,
        policy: 'ask',
        standing: 'new',
      }),
    ])
  })

  /**
   * The row has to exist before the UI offers a toggle, or the toggle would
   * have nothing behind it.
   */
  it('records what it discovered before describing it', async () => {
    const d = makeDeps()
    await listTools(d)
    expect(d.reconcile).toHaveBeenCalledWith('server-1', [weather], 200)
  })

  it('reports nothing when no source has any tools', async () => {
    const d = makeDeps({ catalog: vi.fn().mockResolvedValue([]) })
    const result = await listTools(d)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual([])
  })
})

describe('setEnabled', () => {
  it('enables a tool and tells every window', async () => {
    const d = makeDeps()
    await listTools(d)

    const result = await setEnabled({ source: 'server-1', name: 'get_weather', enabled: true }, d)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0]?.enabled).toBe(true)
    expect(d.notifyTools).toHaveBeenCalledTimes(1)
  })

  it('returns tool/invalid for a malformed request', async () => {
    const d = makeDeps()
    for (const bad of [
      { source: 'server-1', name: 'get_weather' },
      { source: 'server-1', name: 'has space', enabled: true },
      { source: 'bad/source', name: 'get_weather', enabled: true },
      { enabled: true },
      'nonsense',
    ]) {
      const result = await setEnabled(bad, d)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('tool/invalid')
    }
    expect(d.notifyTools).not.toHaveBeenCalled()
  })

  it('returns tool/missing for a tool that was never discovered', async () => {
    const d = makeDeps()
    const result = await setEnabled({ source: 'server-1', name: 'ghost', enabled: true }, d)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('tool/missing')
    expect(d.notifyTools).not.toHaveBeenCalled()
  })

  it('accepts a dotted tool name', async () => {
    const dotted: ToolDefinition = { ...weather, name: 'admin.tools.list' }
    const d = makeDeps({
      catalog: vi.fn().mockResolvedValue([{ source: 'server-1', definition: dotted }]),
    })
    await listTools(d)

    const result = await setEnabled(
      { source: 'server-1', name: 'admin.tools.list', enabled: true },
      d,
    )
    expect(result.ok).toBe(true)
  })

  it('clears standing permission when disabling a tool', async () => {
    const d = makeDeps()
    await listTools(d)
    await setEnabled({ source: 'server-1', name: 'get_weather', enabled: true }, d)
    d.setPolicy('server-1', 'get_weather', 'allow', 200)
    vi.mocked(d.notifyTools).mockClear()

    const result = await setEnabled(
      { source: 'server-1', name: 'get_weather', enabled: false },
      d,
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0]).toMatchObject({ enabled: false, policy: 'ask' })
  })
})

describe('requireApproval', () => {
  it('revokes standing permission without disabling the tool', async () => {
    const d = makeDeps()
    await listTools(d)
    await setEnabled({ source: 'server-1', name: 'get_weather', enabled: true }, d)
    d.setPolicy('server-1', 'get_weather', 'allow', 200)
    vi.mocked(d.notifyTools).mockClear()

    const result = await requireApproval({ source: 'server-1', name: 'get_weather' }, d)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]).toMatchObject({ enabled: true, policy: 'ask' })
    }
    expect(d.setPolicy).toHaveBeenLastCalledWith('server-1', 'get_weather', 'ask', 200)
    expect(d.notifyTools).toHaveBeenCalledTimes(1)
  })

  it('cannot create allow even when an untrusted request includes it', async () => {
    const d = makeDeps()
    await listTools(d)
    await setEnabled({ source: 'server-1', name: 'get_weather', enabled: true }, d)

    const result = await requireApproval(
      { source: 'server-1', name: 'get_weather', policy: 'allow' },
      d,
    )

    expect(result.ok).toBe(true)
    expect(d.setPolicy).toHaveBeenLastCalledWith('server-1', 'get_weather', 'ask', 200)
  })

  it('returns tool/invalid for malformed targets', async () => {
    const d = makeDeps()
    for (const bad of [
      { source: 'server-1', name: 'has space' },
      { source: 'bad/source', name: 'get_weather' },
      { source: 'server-1' },
      'nonsense',
    ]) {
      const result = await requireApproval(bad, d)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('tool/invalid')
    }
    expect(d.setPolicy).not.toHaveBeenCalled()
    expect(d.notifyTools).not.toHaveBeenCalled()
  })

  it('returns tool/missing for a tool that was never discovered', async () => {
    const d = makeDeps()
    const result = await requireApproval({ source: 'server-1', name: 'ghost' }, d)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('tool/missing')
    expect(d.notifyTools).not.toHaveBeenCalled()
  })
})
