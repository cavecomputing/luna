import { describe, expect, it } from 'vitest'
import type { McpEra } from '../../shared/mcp.js'
import { loopback } from '../rpc/loopback.js'
import type { Transport } from '../rpc/transport.js'
import type { McpServerConfig } from './servers.js'
import { sourcesFor, type SourceDeps } from './sources.js'

function config(over: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'server-1',
    name: 'Files',
    command: 'node',
    args: ['server.js'],
    cwd: null,
    envNames: ['TOKEN'],
    enabled: true,
    era: null,
    ...over,
  }
}

type Launch = { config: McpServerConfig; env: Record<string, string> }

function depsFor(
  servers: McpServerConfig[],
  stored: Record<string, Record<string, string>> = {},
): { deps: SourceDeps; launches: Launch[]; eras: (McpEra | null)[] } {
  const launches: Launch[] = []
  const eras: (McpEra | null)[] = []
  const deps: SourceDeps = {
    servers: () => servers,
    readEnv: (id) => Promise.resolve(stored[id]),
    recordEra: (_id, era) => {
      eras.push(era)
    },
    open: (cfg, env): Transport => {
      launches.push({ config: cfg, env })
      return loopback(() => undefined)
    },
  }
  return { deps, launches, eras }
}

describe('sourcesFor', () => {
  it('prefixes a server id so it cannot collide with the built-in source', () => {
    const { deps } = depsFor([config()])
    expect(sourcesFor(deps).map((source) => source.id)).toEqual(['mcp:server-1'])
  })

  it('leaves a disabled server out entirely', () => {
    const { deps } = depsFor([config({ enabled: false })])
    expect(sourcesFor(deps)).toEqual([])
  })

  it('passes a cached era through so the probe can be skipped', () => {
    const { deps } = depsFor([config({ era: 'legacy' })])
    expect(sourcesFor(deps)[0]?.era).toBe('legacy')
  })

  it('omits era rather than passing null when nothing is remembered', () => {
    const { deps } = depsFor([config()])
    expect(Object.hasOwn(sourcesFor(deps)[0] ?? {}, 'era')).toBe(false)
  })

  it('reads credentials at launch and hands them to the process', async () => {
    const { deps, launches } = depsFor([config()], { 'server-1': { TOKEN: 'secret-value' } })
    await sourcesFor(deps)[0]?.open()

    expect(launches).toHaveLength(1)
    expect(launches[0]?.env).toEqual({ TOKEN: 'secret-value' })
  })

  /**
   * The stored blob is whatever was written last. Removing a name from the
   * server's list has to stop that variable reaching the process even while its
   * value is still on disk, or "I took that out" would not be true.
   */
  it('passes only the variables the server is still configured to take', async () => {
    const { deps, launches } = depsFor([config({ envNames: ['TOKEN'] })], {
      'server-1': { TOKEN: 'keep', REMOVED: 'should-not-travel' },
    })
    await sourcesFor(deps)[0]?.open()

    expect(launches[0]?.env).toEqual({ TOKEN: 'keep' })
  })

  it('launches with an empty environment when nothing is stored', async () => {
    const { deps, launches } = depsFor([config()])
    await sourcesFor(deps)[0]?.open()

    expect(launches[0]?.env).toEqual({})
  })

  it('records the era the registry reports back', () => {
    const { deps, eras } = depsFor([config()])
    sourcesFor(deps)[0]?.remember?.('modern')
    expect(eras).toEqual(['modern'])
  })

  it('does not choose a working directory when the server did not', async () => {
    const { deps, launches } = depsFor([config({ cwd: null })])
    await sourcesFor(deps)[0]?.open()
    expect(launches[0]?.config.cwd).toBeNull()
  })
})
