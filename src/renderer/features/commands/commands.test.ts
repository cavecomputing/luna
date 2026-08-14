import { describe, expect, it } from 'vitest'
import { filterCommands, type Command } from './commands.js'

function commands(): Command[] {
  return [
    { id: 'new-chat', label: 'New chat', run: () => undefined },
    { id: 'search', label: 'Search conversations', hint: 'find', run: () => undefined },
    { id: 'sidebar', label: 'Hide sidebar', run: () => undefined },
  ]
}

describe('filterCommands', () => {
  it('returns every command for an empty query', () => {
    expect(filterCommands(commands(), '   ')).toHaveLength(3)
  })

  it('matches regardless of the order the terms are typed', () => {
    expect(filterCommands(commands(), 'chat new').map((command) => command.id)).toEqual([
      'new-chat',
    ])
  })

  it('matches a hint the label does not contain', () => {
    expect(filterCommands(commands(), 'find').map((command) => command.id)).toEqual(['search'])
  })

  it('requires every term to match, not just one', () => {
    expect(filterCommands(commands(), 'new sidebar')).toEqual([])
  })

  it('ignores case', () => {
    expect(filterCommands(commands(), 'HIDE').map((command) => command.id)).toEqual(['sidebar'])
  })
})
