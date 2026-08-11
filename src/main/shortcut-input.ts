import { matchesShortcutKey } from '../shared/keyboard-shortcuts.js'

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

  return matchesShortcutKey(shortcut, input.key, input.code, input.shift)
}

export function closesAuxiliary(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (matchesShortcut(input, 'settings', platform)) return true
  return (
    input.type === 'keyDown' &&
    !input.alt &&
    !input.control &&
    !input.meta &&
    matchesShortcutKey('close', input.key, input.code, input.shift)
  )
}
