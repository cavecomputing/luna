/**
 * Turning configured servers into things the registry can connect to.
 *
 * The one place that knows an MCP server is a subprocess. Above it the registry
 * sees sources; below it `child.ts` sees a command line. This is the joint.
 *
 * Credentials are read inside `open`, which runs at the moment of spawning, and
 * are never held anywhere else. Main does hold them briefly — it has to, to put
 * them in the child's environment — but only for as long as that takes, and
 * never in a cache that outlives the launch.
 */

import { mcpSource, type McpEra } from '../../shared/mcp.js'
import { child } from '../rpc/child.js'
import type { Transport } from '../rpc/transport.js'
import * as secrets from '../secrets.js'
import type { Source } from '../tools/registry.js'
import * as servers from './servers.js'
import type { McpServerConfig } from './servers.js'

export type SourceDeps = {
  /** Every configured server, secrets excluded. */
  servers: () => McpServerConfig[]
  /** The variables one server was given, decrypted. */
  readEnv: (id: string) => Promise<Record<string, string> | undefined>
  open: (config: McpServerConfig, env: Record<string, string>) => Transport
  /** Stores, or clears, what the last handshake with this server concluded. */
  recordEra: (id: string, era: McpEra | null) => void
}

const deps: SourceDeps = {
  servers: servers.load,
  readEnv: secrets.readEnv,
  recordEra: servers.recordEra,
  open: (config, env) =>
    child({
      command: config.command,
      args: config.args,
      ...(config.cwd === null ? {} : { cwd: config.cwd }),
      env,
    }),
}

/**
 * The sources the registry should know about right now.
 *
 * Disabled servers are left out entirely rather than listed as switched off. A
 * source the registry cannot see is a process it cannot start, which is a
 * stronger guarantee than a flag it has to remember to check.
 */
export function sourcesFor(d: SourceDeps = deps): Source[] {
  return d
    .servers()
    .filter((config) => config.enabled)
    .map((config) => ({
      id: mcpSource(config.id),
      label: config.name,
      ...(config.era === null ? {} : { era: config.era }),
      remember: (era) => {
        d.recordEra(config.id, era)
      },
      open: async () => {
        const stored = await d.readEnv(config.id)
        // Only the variables the server is still configured to take. A name
        // removed from the list must stop reaching the process, even if its
        // value has not been erased from storage yet.
        const env: Record<string, string> = {}
        for (const name of config.envNames) {
          const value = stored?.[name]
          if (value !== undefined) env[name] = value
        }
        return d.open(config, env)
      },
    }))
}
