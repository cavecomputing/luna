import { matchesShortcutKey } from '../../../shared/keyboard-shortcuts.js'

type SearchKey = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
>

export function isSearchShortcut(event: SearchKey): boolean {
  return (
    !event.altKey &&
    (event.ctrlKey || event.metaKey) &&
    matchesShortcutKey('search', event.key, event.code, event.shiftKey)
  )
}
