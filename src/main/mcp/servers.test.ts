import { describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { McpServerDraft } from '../../shared/mcp.js'
import { open } from '../db.js'
import { load as loadGrants, reconcile } from '../tool-grants.js'
import { create, find, list, remove, rememberEra, setEnabled, update } from './servers.js'

const draft: McpServerDraft = {
  name: 'Filesystem',
  command: 'npx',
  args: ['-y', '@example/server-filesystem', '/tmp'],
  cwd: null,
  envNames: ['EXAMPLE_TOKEN'],
}

function fresh(): DatabaseSync {
  return open(':memory:')
}

function withServer(id = 'server-1', body: McpServerDraft = draft): DatabaseSync {
  const db = fresh()
  create(db, id, body, 1_000)
  return db
}

describe('create', () => {
  it('stores a server switched off, with no era yet', () => {
    const db = withServer()
    expect(find(db, 'server-1')).toEqual({ id: 'server-1', ...draft, enabled: false, era: null })
  })

  /** Adding a server must never be the thing that starts a process. */
  it('defaults enabled to off even though nothing asked', () => {
    const db = withServer()
    expect(find(db, 'server-1')?.enabled).toBe(false)
  })

  it('round-trips arguments and variable names through their JSON columns', () => {
    const db = withServer('server-1', { ...draft, args: [], envNames: [] })
    expect(find(db, 'server-1')).toMatchObject({ args: [], envNames: [] })
  })

  it('round-trips a working directory', () => {
    const db = withServer('server-1', { ...draft, cwd: '/tmp/work' })
    expect(find(db, 'server-1')?.cwd).toBe('/tmp/work')
  })
})

describe('list', () => {
  it('orders by name without regard to case', () => {
    const db = fresh()
    create(db, 'c', { ...draft, name: 'apple' }, 1)
    create(db, 'a', { ...draft, name: 'Banana' }, 2)
    create(db, 'b', { ...draft, name: 'Cherry' }, 3)

    expect(list(db).map((server) => server.name)).toEqual(['apple', 'Banana', 'Cherry'])
  })

  /**
   * A row is unknown until it parses. Dropping one bad server is better than
   * launching a command line nobody wrote, and better than refusing to show the
   * others.
   */
  it('drops a row whose stored arguments are not a list', () => {
    const db = withServer()
    create(db, 'server-2', { ...draft, name: 'Second' }, 2_000)
    db.exec(`UPDATE mcp_servers SET args = '"not a list"' WHERE id = 'server-1'`)

    expect(list(db).map((server) => server.id)).toEqual(['server-2'])
  })

  it('drops a row carrying a variable name that no longer parses', () => {
    const db = withServer()
    db.exec(`UPDATE mcp_servers SET env_names = '["HAS SPACE"]' WHERE id = 'server-1'`)
    expect(list(db)).toEqual([])
  })

  it('drops a row whose arguments column is not valid JSON', () => {
    const db = withServer()
    db.exec(`UPDATE mcp_servers SET args = 'not json' WHERE id = 'server-1'`)
    expect(list(db)).toEqual([])
  })
})

describe('update', () => {
  it('rewrites the definition and reports the new one', () => {
    const db = withServer()
    const changed = update(db, 'server-1', { ...draft, name: 'Renamed', command: 'node' })

    expect(changed).toMatchObject({ name: 'Renamed', command: 'node' })
    expect(find(db, 'server-1')?.command).toBe('node')
  })

  /**
   * How a server is launched decides which protocol answers, so a verdict about
   * the old command line says nothing about the new one.
   */
  it('forgets the remembered era, because the command changed', () => {
    const db = withServer()
    rememberEra(db, 'server-1', 'legacy')
    expect(find(db, 'server-1')?.era).toBe('legacy')

    update(db, 'server-1', { ...draft, command: 'something-else' })
    expect(find(db, 'server-1')?.era).toBeNull()
  })

  it('reports nothing for a server that is not there', () => {
    expect(update(fresh(), 'missing', draft)).toBeUndefined()
  })
})

describe('setEnabled', () => {
  it('turns a server on and off', () => {
    const db = withServer()
    expect(setEnabled(db, 'server-1', true)?.enabled).toBe(true)
    expect(setEnabled(db, 'server-1', false)?.enabled).toBe(false)
  })

  it('reports nothing for a server that is not there', () => {
    expect(setEnabled(fresh(), 'missing', true)).toBeUndefined()
  })
})

describe('rememberEra', () => {
  it('stores and clears what the last handshake concluded', () => {
    const db = withServer()
    rememberEra(db, 'server-1', 'modern')
    expect(find(db, 'server-1')?.era).toBe('modern')

    rememberEra(db, 'server-1', null)
    expect(find(db, 'server-1')?.era).toBeNull()
  })

  it('refuses an era the schema does not recognize', () => {
    const db = withServer()
    expect(() => {
      db.exec(`UPDATE mcp_servers SET era = 'ancient' WHERE id = 'server-1'`)
    }).toThrow()
  })
})

describe('remove', () => {
  it('forgets the server', () => {
    const db = withServer()
    expect(remove(db, 'server-1')).toBe(true)
    expect(find(db, 'server-1')).toBeUndefined()
    expect(remove(db, 'server-1')).toBe(false)
  })

  /**
   * A grant outliving its server is a standing permission with nothing visible
   * behind it — and if the id were ever reused, a permission somebody granted
   * to a different program entirely.
   */
  it('forgets every decision made about its tools', () => {
    const db = withServer()
    reconcile(db, 'mcp:server-1', [
      { name: 'read_file', description: '', inputSchema: { type: 'object' } },
    ], 100)
    reconcile(db, 'builtin', [
      { name: 'luna_echo', description: '', inputSchema: { type: 'object' } },
    ], 100)
    expect([...loadGrants(db).keys()]).toHaveLength(2)

    remove(db, 'server-1')

    // The other source's grant is untouched.
    expect([...loadGrants(db).keys()]).toEqual(['builtin:luna_echo'])
  })

  it('leaves grants alone when there was no such server', () => {
    const db = fresh()
    reconcile(db, 'builtin', [
      { name: 'luna_echo', description: '', inputSchema: { type: 'object' } },
    ], 100)

    expect(remove(db, 'never-existed')).toBe(false)
    expect([...loadGrants(db).keys()]).toEqual(['builtin:luna_echo'])
  })
})
