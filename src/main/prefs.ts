import { app, nativeTheme } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultPrefs, parsePrefs, type Prefs } from '../shared/prefs.js'

let cache: Prefs | undefined

function file(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

/** Reads once, then serves from memory. */
export async function load(): Promise<Prefs> {
  if (cache !== undefined) return cache

  try {
    const text = await readFile(file(), 'utf8')
    cache = parsePrefs(JSON.parse(text))
  } catch {
    // Missing or unreadable is normal on first run, and a corrupt file should
    // not stop the app from starting. Defaults, then move on.
    cache = { ...defaultPrefs }
  }

  return cache
}

/**
 * Writes to a temp file in the same directory then renames. A crash mid-write
 * leaves the previous file intact rather than a half-written one.
 */
export async function save(prefs: Prefs): Promise<Prefs> {
  cache = prefs
  const target = file()
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(prefs, null, 2), 'utf8')
  await rename(temp, target)
  return prefs
}

/** Push the stored theme into Chromium so prefers-color-scheme follows it. */
export function applyTheme(prefs: Prefs): void {
  nativeTheme.themeSource = prefs.theme
}
