export type ShortcutInput = {
  type: string
  key: string
  code: string
  alt: boolean
  control: boolean
  meta: boolean
  shift: boolean
}

export type WindowShortcut = 'newChat' | 'commandPalette' | 'settings' | 'shortcuts'

export function matchesShortcut(
  input: ShortcutInput,
  shortcut: WindowShortcut,
  platform: NodeJS.Platform,
): boolean {
  const primary = platform === 'darwin' ? input.meta : input.control
  if (input.type !== 'keyDown' || !primary || input.alt) return false

  const expected = {
    newChat: { key: 'n', code: 'KeyN', shift: false },
    commandPalette: { key: 'p', code: 'KeyP', shift: false },
    settings: { key: ',', code: 'Comma', shift: false },
    shortcuts: { key: '?', code: 'Slash', shift: true },
  }[shortcut]

  if (input.shift !== expected.shift) return false
  if (input.code === expected.code) return true
  if (expected.key.length === 1 && expected.key !== '?') {
    return input.key.toLowerCase() === expected.key
  }
  return input.key === expected.key
}

export function closesAuxiliary(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (matchesShortcut(input, 'settings', platform)) return true
  return (
    input.type === 'keyDown' &&
    !input.alt &&
    !input.control &&
    !input.meta &&
    !input.shift &&
    (input.key === 'Escape' || input.code === 'Escape')
  )
}
