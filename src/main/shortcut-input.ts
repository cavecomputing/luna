export type ShortcutInput = {
  type: string
  key: string
  code: string
  alt: boolean
  control: boolean
  meta: boolean
  shift: boolean
}

export type WindowShortcut = 'settings' | 'shortcuts'

export function matchesShortcut(
  input: ShortcutInput,
  shortcut: WindowShortcut,
  platform: NodeJS.Platform,
): boolean {
  const primary = platform === 'darwin' ? input.meta : input.control
  if (input.type !== 'keyDown' || !primary || input.alt) return false

  if (shortcut === 'settings') {
    return !input.shift && (input.key === ',' || input.code === 'Comma')
  }

  return input.shift && (input.key === '?' || input.code === 'Slash')
}
