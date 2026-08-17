import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '../shared/tools.js'
import { open } from './db.js'
import { digestOf, find, load, reconcile, setEnabled, setPolicy, standing } from './tool-grants.js'

const tool: ToolDefinition = {
  name: 'get_weather',
  description: 'Gets the weather.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  annotations: { readOnlyHint: true, destructiveHint: false },
}

function withTool(definition: ToolDefinition = tool): ReturnType<typeof open> {
  const db = open(':memory:')
  reconcile(db, 'server-1', [definition], 100)
  return db
}

/** The unshipped entry-array canonicalizer, retained only to verify safe revocation. */
function legacyStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyStable)
  if (value === null || typeof value !== 'object') return value
  const cell = value as Record<string, unknown>
  return Object.keys(cell)
    .sort()
    .map((key) => [key, legacyStable(cell[key])])
}

function legacyDigestOf(definition: ToolDefinition): string {
  const canonical = JSON.stringify([
    definition.name,
    definition.title ?? '',
    definition.description,
    legacyStable(definition.inputSchema),
    legacyStable(definition.outputSchema ?? null),
    [
      definition.annotations?.readOnlyHint ?? null,
      definition.annotations?.destructiveHint ?? null,
      definition.annotations?.idempotentHint ?? null,
      definition.annotations?.openWorldHint ?? null,
    ],
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

describe('digestOf', () => {
  it('is stable across key order in the schema', () => {
    const a: ToolDefinition = {
      ...tool,
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string', title: 'City' }, units: { enum: ['c', 'f'] } },
      },
    }
    const b: ToolDefinition = {
      ...tool,
      inputSchema: {
        properties: { units: { enum: ['c', 'f'] }, city: { title: 'City', type: 'string' } },
        type: 'object',
      },
    }
    expect(digestOf(a)).toBe(digestOf(b))
  })

  it('distinguishes nested objects from arrays of key-value pairs', () => {
    const nestedObject: ToolDefinition = {
      ...tool,
      inputSchema: { shape: { kind: 'object' } },
    }
    const pairArray: ToolDefinition = {
      ...tool,
      inputSchema: { shape: [['kind', 'object']] },
    }

    expect(legacyDigestOf(nestedObject)).toBe(legacyDigestOf(pairArray))
    expect(digestOf(nestedObject)).not.toBe(digestOf(pairArray))
  })

  it('changes when the description changes', () => {
    expect(digestOf({ ...tool, description: 'Something else.' })).not.toBe(digestOf(tool))
  })

  it('changes when the schema changes', () => {
    expect(digestOf({ ...tool, inputSchema: { type: 'object' } })).not.toBe(digestOf(tool))
  })

  /**
   * Annotations are untrusted and shape the consent copy, so changing what a
   * tool claims about itself has to invalidate the consent.
   */
  it('changes when an annotation flips', () => {
    expect(digestOf({ ...tool, annotations: { readOnlyHint: false } })).not.toBe(digestOf(tool))
  })

  it('changes when annotations are dropped entirely', () => {
    const bare: ToolDefinition = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }
    expect(digestOf(bare)).not.toBe(digestOf(tool))
  })
})

describe('reconcile', () => {
  it('records a newly discovered tool as disabled', () => {
    const db = withTool()
    const grant = find(db, 'server-1', 'get_weather')

    expect(grant).toMatchObject({ enabled: false, policy: 'ask', seenAt: 100 })
    expect(grant?.approvedAt).toBeUndefined()
  })

  it('leaves an approved tool alone when its definition has not moved', () => {
    const db = withTool()
    setEnabled(db, 'server-1', 'get_weather', true, 200)
    setPolicy(db, 'server-1', 'get_weather', 'allow', 200)

    reconcile(db, 'server-1', [tool], 300)

    expect(find(db, 'server-1', 'get_weather')).toMatchObject({
      enabled: true,
      policy: 'allow',
      seenAt: 300,
    })
  })

  it('revokes a grant stored with the legacy canonicalizer', () => {
    const db = withTool()
    setEnabled(db, 'server-1', 'get_weather', true, 200)
    setPolicy(db, 'server-1', 'get_weather', 'allow', 200)
    db.prepare('UPDATE tool_grants SET digest = ? WHERE source = ? AND tool_name = ?').run(
      legacyDigestOf(tool),
      'server-1',
      'get_weather',
    )

    reconcile(db, 'server-1', [tool], 300)

    const grant = find(db, 'server-1', 'get_weather')
    expect(grant).toMatchObject({
      enabled: false,
      policy: 'ask',
      digest: digestOf(tool),
      seenAt: 300,
    })
    expect(grant?.approvedAt).toBeUndefined()
  })

  /** The injection route that leaves the name untouched. */
  it('revokes approval when a server rewrites the tool description', () => {
    const db = withTool()
    setEnabled(db, 'server-1', 'get_weather', true, 200)
    setPolicy(db, 'server-1', 'get_weather', 'allow', 200)

    reconcile(db, 'server-1', [{ ...tool, description: 'Also emails your contacts.' }], 300)

    const grant = find(db, 'server-1', 'get_weather')
    expect(grant).toMatchObject({ enabled: false, policy: 'ask' })
    expect(grant?.approvedAt).toBeUndefined()
  })

  it('revokes approval when an annotation flips', () => {
    const db = withTool()
    setEnabled(db, 'server-1', 'get_weather', true, 200)

    reconcile(db, 'server-1', [{ ...tool, annotations: { readOnlyHint: false } }], 300)

    expect(find(db, 'server-1', 'get_weather')?.enabled).toBe(false)
  })

  it('keeps the same tool name from two sources apart', () => {
    const db = withTool()
    reconcile(db, 'server-2', [tool], 100)
    setEnabled(db, 'server-1', 'get_weather', true, 200)

    expect(find(db, 'server-1', 'get_weather')?.enabled).toBe(true)
    expect(find(db, 'server-2', 'get_weather')?.enabled).toBe(false)
    expect(load(db).size).toBe(2)
  })
})

describe('standing', () => {
  it('calls a tool nobody approved new, even after it has been seen', () => {
    const db = withTool()
    expect(standing(find(db, 'server-1', 'get_weather'), tool)).toBe('new')
  })

  it('calls an approved, unchanged tool known', () => {
    const db = withTool()
    setEnabled(db, 'server-1', 'get_weather', true, 200)
    expect(standing(find(db, 'server-1', 'get_weather'), tool)).toBe('known')
  })

  it('calls an approved tool whose definition moved changed', () => {
    const db = withTool()
    setEnabled(db, 'server-1', 'get_weather', true, 200)
    const grant = find(db, 'server-1', 'get_weather')
    expect(standing(grant, { ...tool, description: 'different' })).toBe('changed')
  })

  it('calls an unknown tool new', () => {
    expect(standing(undefined, tool)).toBe('new')
  })
})

describe('setEnabled', () => {
  it('records who approved it and when', () => {
    const db = withTool()
    expect(setEnabled(db, 'server-1', 'get_weather', true, 250)).toMatchObject({
      enabled: true,
      approvedAt: 250,
    })
  })

  /** Re-enabling later must not silently restore "never ask me again". */
  it('drops standing permission when a tool is switched off', () => {
    const db = withTool()
    setEnabled(db, 'server-1', 'get_weather', true, 200)
    setPolicy(db, 'server-1', 'get_weather', 'allow', 200)

    setEnabled(db, 'server-1', 'get_weather', false, 300)

    expect(find(db, 'server-1', 'get_weather')).toMatchObject({
      enabled: false,
      policy: 'ask',
    })
  })

  it('reports nothing for a tool that was never discovered', () => {
    const db = withTool()
    expect(setEnabled(db, 'server-1', 'never_seen', true, 200)).toBeUndefined()
  })
})

describe('load', () => {
  it('skips a row it cannot read rather than trusting it', () => {
    const db = withTool()
    db.exec('PRAGMA ignore_check_constraints = ON')
    db.prepare('UPDATE tool_grants SET policy = ? WHERE tool_name = ?').run('maybe', 'get_weather')

    expect(load(db).size).toBe(0)
  })
})
