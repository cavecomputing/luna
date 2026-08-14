import type { KeyboardShortcutId } from '../../../shared/keyboard-shortcuts.js'

export type Command = {
  id: string
  label: string
  /** Extra words to match on, for commands you'd look up by something else. */
  hint?: string
  /** Draws this shortcut's keys beside the row. */
  shortcut?: KeyboardShortcutId
  run: () => void
}

/**
 * Every term has to land somewhere in the label or hint, so word order doesn't
 * matter — "chat new" finds New chat the same as "new chat" does.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== '')
  if (terms.length === 0) return commands
  return commands.filter((command) => {
    const haystack = `${command.label} ${command.hint ?? ''}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
