import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const prefix = 'setup-hooks:'

/** @param {string} message */
function write(message) {
  process.stdout.write(`${prefix} ${message}\n`)
}

/**
 * @param {string[]} args
 * @param {string | undefined} [cwd]
 */
function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

if (process.env.CI) {
  write('CI detected — skipping')
} else {
  /** @type {string | undefined} */
  let root

  try {
    root = git(['rev-parse', '--show-toplevel'])
  } catch {
    write('not a git repository — skipping')
  }

  if (root !== undefined) {
    const hooks = join(root, '.githooks')

    if (!existsSync(hooks)) {
      write('.githooks/ not found — skipping')
    } else {
      // Git for Windows supplies the shell used to run these hooks. POSIX Git
      // additionally needs their executable bits set.
      if (process.platform !== 'win32') {
        for (const entry of readdirSync(hooks, { withFileTypes: true })) {
          if (entry.isFile()) chmodSync(join(hooks, entry.name), 0o755)
        }
      }

      git(['config', 'core.hooksPath', '.githooks'], root)
      write('git hooks enabled from .githooks/')
    }
  }
}
