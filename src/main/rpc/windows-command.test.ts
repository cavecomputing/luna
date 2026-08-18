import { describe, expect, it } from 'vitest'
import { commandLine, isBatch, launch, quoteArgument, resolve } from './windows-command.js'

const WINDOWS = { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }

describe('quoteArgument', () => {
  it('quotes a plain argument', () => {
    expect(quoteArgument('server')).toBe('"server"')
  })

  it('keeps a space inside one argument', () => {
    expect(quoteArgument('two words')).toBe('"two words"')
  })

  it('escapes an embedded quote', () => {
    expect(quoteArgument('say "hi"')).toBe('"say \\"hi\\""')
  })

  /** A lone trailing backslash would otherwise escape the closing quote. */
  it('doubles backslashes that precede the closing quote', () => {
    expect(quoteArgument('C:\\path\\')).toBe('"C:\\path\\\\"')
  })

  it('doubles backslashes that precede an embedded quote', () => {
    expect(quoteArgument('a\\"b')).toBe('"a\\\\\\"b"')
  })

  it('leaves an interior backslash alone', () => {
    expect(quoteArgument('C:\\tmp\\dir')).toBe('"C:\\tmp\\dir"')
  })

  it('produces an empty pair for an empty argument', () => {
    expect(quoteArgument('')).toBe('""')
  })
})

describe('commandLine', () => {
  it('escapes the metacharacters cmd would act on', () => {
    expect(commandLine('npx.cmd', [])).toBe('npx.cmd')
    expect(commandLine('C:\\Program Files\\npx.cmd', [])).toBe('C:\\Program^ Files\\npx.cmd')
  })

  /**
   * A batch file's arguments are parsed twice — once by the cmd that runs the
   * file, once when the interpreter expands %1 — so one round of escaping
   * survives to the program and the other is consumed on the way.
   */
  it('escapes argument metacharacters twice', () => {
    expect(commandLine('run.cmd', ['a&b'])).toBe('run.cmd ^^^"a^^^&b^^^"')
  })

  it('escapes the characters an attacker would reach for', () => {
    for (const character of ['&', '|', ';', '<', '>', '^', '%', '!', '(', ')']) {
      const line = commandLine('run.cmd', [`x${character}y`])
      expect(line).toContain(`^^^${character}`)
    }
  })
})

describe('isBatch', () => {
  it('recognizes the extensions cmd interprets, whatever their case', () => {
    expect(isBatch('npx.cmd')).toBe(true)
    expect(isBatch('C:\\tools\\Run.BAT')).toBe(true)
    expect(isBatch('node.exe')).toBe(false)
    expect(isBatch('/usr/bin/node')).toBe(false)
  })
})

describe('launch', () => {
  it('spawns a real executable directly on every platform', () => {
    expect(launch('node', ['server.js'], 'darwin', {})).toEqual({
      command: 'node',
      args: ['server.js'],
      verbatim: false,
    })
    expect(launch('node.exe', ['server.js'], 'win32', WINDOWS)).toEqual({
      command: 'node.exe',
      args: ['server.js'],
      verbatim: false,
    })
  })

  /** A .cmd on a POSIX host is just a file with an odd name. */
  it('does not rewrite a batch name off Windows', () => {
    expect(launch('npx.cmd', [], 'linux', {})?.command).toBe('npx.cmd')
  })

  it('routes a batch file through cmd.exe verbatim', () => {
    expect(launch('npx.cmd', ['-y', 'a-server'], 'win32', WINDOWS)).toEqual({
      command: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/s', '/c', '"npx.cmd ^^^"-y^^^" ^^^"a-server^^^""'],
      verbatim: true,
    })
  })

  it('falls back to cmd.exe when ComSpec is unset', () => {
    expect(launch('npx.cmd', [], 'win32', {})?.command).toBe('cmd.exe')
  })

  /**
   * A newline would end the command line early and start a second one, which is
   * the whole game. There is no escaping that makes it safe, so it is refused —
   * but only where a line is actually built.
   */
  it('refuses a newline on the path that builds a command line', () => {
    expect(launch('C:\\tools\\evil\n.cmd', [], 'win32', WINDOWS)).toBeUndefined()
    expect(launch('npx.cmd', ['a\r\nb'], 'win32', WINDOWS)).toBeUndefined()
  })

  /** An argv array carries a newline fine, and a server argument may hold one. */
  it('allows a newline in an argument passed as argv', () => {
    expect(launch('node', ['-e', 'let a = 1\nlet b = 2'], 'darwin', {})?.args).toEqual([
      '-e',
      'let a = 1\nlet b = 2',
    ])
  })

  it('refuses a NUL on every platform', () => {
    expect(launch('node', ['a\0b'], 'darwin', {})).toBeUndefined()
    expect(launch('npx.cmd', ['a\0b'], 'win32', WINDOWS)).toBeUndefined()
  })
})

describe('resolve', () => {
  const env = { PATH: 'C:\\bin;C:\\node', PATHEXT: '.COM;.EXE;.BAT;.CMD' }

  /**
   * Case-insensitive, because NTFS is. That is also why a resolved path carries
   * PATHEXT's case rather than the file's — `npx.CMD` and `npx.cmd` name the
   * same file, and `isBatch` lowercases before it compares.
   */
  const present = (paths: readonly string[]) => (path: string) =>
    paths.some((entry) => entry.toLowerCase() === path.toLowerCase())

  it('finds a bare name through PATHEXT', () => {
    const found = resolve('npx', env, present(['C:\\node\\npx.cmd']))
    expect(found).toBe('C:\\node\\npx.CMD')
    expect(isBatch(found ?? '')).toBe(true)
  })

  it('searches PATH entries in order', () => {
    const found = present(['C:\\bin\\tool.exe', 'C:\\node\\tool.exe'])
    expect(resolve('tool', env, found)).toBe('C:\\bin\\tool.EXE')
  })

  it('prefers the earlier PATHEXT entry within one directory', () => {
    const found = present(['C:\\bin\\tool.cmd', 'C:\\bin\\tool.exe'])
    expect(resolve('tool', env, found)).toBe('C:\\bin\\tool.EXE')
  })

  /**
   * npm installs an extensionless POSIX script beside npx.cmd. Windows cannot
   * execute it, so a bare name must never resolve to it.
   */
  it('never resolves a bare name to an extensionless file', () => {
    expect(resolve('npx', env, present(['C:\\node\\npx']))).toBeUndefined()
  })

  it('resolves a name that already carries an extension to itself', () => {
    const found = present(['C:\\node\\npx.cmd', 'C:\\node\\npx.cmd.exe'])
    expect(resolve('npx.cmd', env, found)).toBe('C:\\node\\npx.cmd')
  })

  it('probes only where a path points', () => {
    expect(resolve('C:\\tools\\run', env, present(['C:\\tools\\run.bat']))).toBe(
      'C:\\tools\\run.BAT',
    )
    expect(resolve('C:\\tools\\run', env, present(['C:\\bin\\run.bat']))).toBeUndefined()
  })

  it('strips quotes from a PATH entry', () => {
    const quoted = { ...env, PATH: '"C:\\Program Files\\node"' }
    const found = present(['C:\\Program Files\\node\\npx.cmd'])
    expect(resolve('npx', quoted, found)).toBe('C:\\Program Files\\node\\npx.CMD')
  })

  it('reports nothing when the command is not on PATH', () => {
    expect(resolve('missing', env, present([]))).toBeUndefined()
  })
})
