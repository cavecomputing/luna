/**
 * Launching a command on Windows without handing the shell a string.
 *
 * Two Windows-only problems stand between `spawn` and a working MCP server, and
 * both bite the most common case there is — `npx some-server`.
 *
 * **A bare name does not resolve.** There is no file called `npx`; there is
 * `npx.cmd`. POSIX finds executables by mode bit, Windows finds them by
 * extension, and `spawn` with `shell: false` does no PATHEXT search of its own.
 *
 * **Node refuses to execute `.cmd` and `.bat` directly.** Since the fix for
 * CVE-2024-27980 it rejects them unless `shell: true`, and `shell: true` is
 * exactly what we must not do: it concatenates the command line and hands it to
 * `cmd.exe` to re-parse, which turns a server's arguments into an injection
 * vector against a command line the user's own configuration controls.
 *
 * So we invoke `cmd.exe` ourselves, escape every character it would act on, and
 * pass `windowsVerbatimArguments` so Node does not re-quote what we built.
 *
 * Everything here is pure and takes its platform, environment, and filesystem
 * probe as arguments, because none of it can run on the machine it is written
 * on.
 */

/** Extensions cmd.exe interprets rather than executes. */
const BATCH = ['.cmd', '.bat']

/**
 * Characters cmd.exe consumes before the target program ever sees them.
 *
 * A superset of what is strictly required. Escaping a character that did not
 * need it costs nothing, because `^` before an ordinary character is dropped.
 */
const META = /([()[\]{}%!^"`<>&|;, *?=])/g

/**
 * A newline ends a command line and starts a second one, which no escaping
 * fixes. It only matters where we build a line — argv arrays carry newlines
 * perfectly well, and a server argument is entitled to contain one.
 */
const NEWLINE = /[\r\n]/

export function isBatch(command: string): boolean {
  const lower = command.toLowerCase()
  return BATCH.some((extension) => lower.endsWith(extension))
}

/**
 * Quotes one argument for the parser the target program links against.
 *
 * Backslashes are literal except immediately before a quote, where each one
 * doubles, and at the end, where they would otherwise escape the closing quote
 * we add.
 */
export function quoteArgument(value: string): string {
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${escaped}"`
}

function escapeMeta(value: string): string {
  return value.replace(META, '^$1')
}

/**
 * Builds the line that goes inside `cmd.exe /d /s /c "…"`.
 *
 * The command is escaped once: cmd parses it once. Arguments are escaped twice,
 * because a batch file's arguments are parsed a second time when the
 * interpreter expands `%1`.
 *
 * The command is not quoted — escaping its spaces achieves the same thing and
 * composes with `/s`, which strips exactly the outermost quote pair and takes
 * everything between them verbatim.
 */
export function commandLine(command: string, args: readonly string[]): string {
  return [
    escapeMeta(command),
    ...args.map((arg) => escapeMeta(escapeMeta(quoteArgument(arg)))),
  ].join(' ')
}

export type Launch = {
  command: string
  args: string[]
  /** Node must not re-quote a line we escaped by hand. */
  verbatim: boolean
}

/**
 * Rewrites a batch-file launch into a `cmd.exe` launch, and leaves anything
 * else alone. A real executable is spawned directly, on every platform.
 */
export function launch(
  command: string,
  args: readonly string[],
  platform: string,
  env: Record<string, string | undefined>,
): Launch | undefined {
  const all = [command, ...args]
  // No platform can carry a NUL in an argument, and Node throws on one rather
  // than truncating. Refusing it here keeps that a Result instead of an
  // exception out of spawn.
  if (all.some((value) => value.includes('\0'))) return undefined
  if (platform !== 'win32' || !isBatch(command)) {
    return { command, args: [...args], verbatim: false }
  }
  // Past here we are building a line for cmd.exe to parse, so a newline stops
  // being ordinary data.
  if (all.some((value) => NEWLINE.test(value))) return undefined
  return {
    command: env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine(command, args)}"`],
    verbatim: true,
  }
}

/**
 * Finds what a bare command name means on Windows.
 *
 * A name carrying a separator is a path and is only probed where it points; a
 * bare name is searched along PATH, in PATHEXT order.
 *
 * A name that already ends in a PATHEXT extension resolves to itself and
 * nothing else. A name without one never resolves to itself, only to a
 * candidate with an extension appended — which is what cmd.exe does, and what
 * keeps `npx` finding `npx.cmd` rather than the extensionless shell script npm
 * installs beside it, which Windows cannot execute.
 */
export function resolve(
  command: string,
  env: Record<string, string | undefined>,
  isFile: (path: string) => boolean,
): string | undefined {
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter((entry) => entry !== '')
  const lower = command.toLowerCase()
  const candidates = extensions.some((extension) => lower.endsWith(extension.toLowerCase()))
    ? [command]
    : extensions.map((extension) => `${command}${extension}`)

  if (/[\\/]/.test(command)) return candidates.find((path) => isFile(path))

  for (const dir of (env.PATH ?? env.Path ?? '').split(';')) {
    if (dir === '') continue
    const trimmed = dir.replace(/^"|"$/g, '')
    const found = candidates.find((name) => isFile(`${trimmed}\\${name}`))
    if (found !== undefined) return `${trimmed}\\${found}`
  }
  return undefined
}
