/**
 * A transport whose far side is a subprocess speaking newline-delimited JSON
 * over its standard streams.
 *
 * This is the first thing in Luna that runs somebody else's program. Everything
 * here that looks like paranoia is load-bearing:
 *
 * - **`shell: false`, always.** The command and its arguments come from the
 *   user's server configuration and are passed as an argv array, never
 *   concatenated into a line for a shell to re-parse. Windows batch files
 *   cannot be executed that way at all, which `windows-command.ts` handles by
 *   building the `cmd.exe` line itself rather than reaching for `shell: true`.
 * - **The environment is built, not inherited.** A third-party process gets the
 *   variables it needs to find its own runtime plus whatever the user
 *   configured, and nothing else of Luna's.
 * - **stderr is drained and discarded.** Draining is not optional: an unread
 *   pipe fills at about 64KB and the child then blocks forever on its next
 *   write, which presents as a server that mysteriously stopped answering.
 *   Discarding is not optional either — a server's stderr routinely carries
 *   file paths and user content, and neither may be logged.
 *
 * Framing is not done here. `connect.ts` owns it, because a chunk boundary has
 * nothing to do with a message boundary and the reader is the only place that
 * can know the difference.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync } from 'node:fs'
import { err, ok, type Result } from '../../shared/result.js'
import type { CloseReason, Transport } from './transport.js'
import { launch, resolve } from './windows-command.js'

export type ChildSpec = {
  command: string
  args: readonly string[]
  cwd?: string
  /** Extra variables for this server, merged over the base set below. */
  env: Record<string, string>
}

/**
 * Variables a spawned server may see from Luna's own environment.
 *
 * An allowlist rather than a denylist: the failure mode of forgetting an entry
 * is a server that cannot find its runtime, which is loud. The failure mode of
 * forgetting to exclude one is a credential in a third-party process, which is
 * silent.
 */
const INHERITED: Record<string, readonly string[]> = {
  win32: [
    'APPDATA',
    'ComSpec',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'ProgramData',
    'ProgramFiles',
    'SystemDrive',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'windir',
  ],
  other: ['HOME', 'LANG', 'LC_ALL', 'PATH', 'SHELL', 'TMPDIR', 'TZ', 'USER'],
}

export function baseEnv(
  platform: string,
  parent: Record<string, string | undefined>,
): Record<string, string> {
  const names = INHERITED[platform === 'win32' ? 'win32' : 'other'] ?? []
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = parent[name]
    if (value !== undefined) out[name] = value
  }
  return out
}

export type SpawnDeps = {
  spawn: typeof spawn
  platform: string
  parentEnv: Record<string, string | undefined>
  /** Probe used to turn a bare Windows command name into a real file. */
  isFile: (path: string) => boolean
}

/**
 * Resolved once so tests can hand in a fake without touching the real disk.
 *
 * `statSync` is the one deliberate exception to async-only I/O in main. It runs
 * on Windows only, a few dozen times, once per server start rather than once
 * per request, and it backs a pure resolver that would have to become async
 * everywhere to avoid it. Nothing here is on a path a window waits behind.
 */
function defaults(): SpawnDeps {
  return {
    spawn,
    platform: process.platform,
    parentEnv: process.env,
    isFile: (path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    },
  }
}

export function child(spec: ChildSpec, deps: SpawnDeps = defaults()): Transport {
  let proc: ChildProcessWithoutNullStreams | undefined
  let lines: ((chunk: string) => void) | undefined
  let closes: ((reason: CloseReason) => void) | undefined
  let done = false

  /** Announced exactly once, whatever combination of events got us here. */
  function finish(reason: CloseReason): void {
    if (done) return
    done = true
    closes?.(reason)
  }

  function exited(): Promise<void> {
    if (done || proc === undefined) return Promise.resolve()
    return new Promise<void>((settle) => {
      proc?.once('close', () => {
        settle()
      })
    })
  }

  /** Resolves when the process is gone, or when `ms` elapses — whichever first. */
  function within(ms: number): Promise<void> {
    return Promise.race([
      exited(),
      new Promise<void>((settle) => {
        setTimeout(settle, ms).unref()
      }),
    ])
  }

  return {
    start: (signal: AbortSignal): Promise<Result<undefined>> => {
      if (signal.aborted) return Promise.resolve(err('rpc/cancelled', 'cancelled before start'))

      const command =
        deps.platform === 'win32'
          ? (resolve(spec.command, deps.parentEnv, deps.isFile) ?? spec.command)
          : spec.command
      const plan = launch(command, spec.args, deps.platform, deps.parentEnv)
      if (plan === undefined) return Promise.resolve(err('rpc/spawn', 'command was not usable'))

      return new Promise<Result<undefined>>((settle) => {
        let answered = false
        const onAbort = (): void => {
          proc?.kill()
        }
        const answer = (result: Result<undefined>): void => {
          if (answered) return
          answered = true
          // Startup is over, so the caller's signal stops being ours to watch.
          // It belongs to a turn, and a turn ending must not kill a live server.
          signal.removeEventListener('abort', onAbort)
          settle(result)
        }

        let started: ChildProcessWithoutNullStreams
        try {
          started = deps.spawn(plan.command, plan.args, {
            ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
            env: { ...baseEnv(deps.platform, deps.parentEnv), ...spec.env },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
            windowsVerbatimArguments: plan.verbatim,
          })
        } catch {
          // Node validates the arguments before it forks; a rejection here is
          // ours to report, not a process that died.
          answer(err('rpc/spawn', 'server could not be started'))
          return
        }
        proc = started

        started.stdout.setEncoding('utf8')
        started.stdout.on('data', (chunk: string) => {
          lines?.(chunk)
        })
        // Flowing with no listener, which drains and drops it. See the note at
        // the top of this file: both halves of that matter.
        started.stderr.resume()
        // A server that exits mid-write leaves us writing to a closed pipe.
        // That is its death arriving out of order, not a fault of ours.
        started.stdin.on('error', () => undefined)

        started.on('error', () => {
          answer(err('rpc/spawn', 'server could not be started'))
          finish({ kind: 'error' })
        })
        started.on('close', (code) => {
          answer(err('rpc/spawn', 'server exited before it was ready'))
          finish({ kind: 'exit', code })
        })
        started.on('spawn', () => {
          answer(ok(undefined))
        })

        signal.addEventListener('abort', onAbort, { once: true })
      })
    },

    send: (line: string): void => {
      if (done || proc === undefined) return
      proc.stdin.write(`${line}\n`)
    },

    onData: (fn: (chunk: string) => void): void => {
      lines = fn
    },

    onClose: (fn: (reason: CloseReason) => void): void => {
      closes = fn
    },

    /**
     * Ends the process, escalating only as far as it has to.
     *
     * Closing stdin first is the specified shutdown and the only portable one:
     * a server is meant to exit on EOF. Signals come after, and only because a
     * server that ignores EOF would otherwise outlive the app that started it.
     */
    stop: async (grace: number): Promise<void> => {
      const running = proc
      if (running === undefined || done) {
        finish({ kind: 'stopped' })
        return
      }

      const half = Math.max(0, Math.floor(grace / 2))
      running.stdin.end()
      await within(half)
      if (!done) {
        // Emulated on Windows, where it is TerminateProcess and already final.
        running.kill('SIGTERM')
        await within(grace - half)
      }
      if (!done) {
        running.kill('SIGKILL')
        await within(half)
      }
      finish({ kind: 'stopped' })
    },
  }
}
