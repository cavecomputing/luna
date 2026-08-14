// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../shared/types.js'
import { ChatSearch } from './chat-search.js'

afterEach(cleanup)

function chat(id: string, title: string, updatedAt: number): Conversation {
  return {
    id,
    title,
    draft: '',
    mode: 'fast',
    pinned: false,
    messages: [],
    updatedAt,
  }
}

describe('ChatSearch', () => {
  it('moves through results with arrows and opens the active result', () => {
    const select = vi.fn()
    render(
      <ChatSearch
        chats={[chat('first', 'First chat', 3), chat('second', 'Second chat', 2)]}
        now={4}
        onClose={() => undefined}
        onSelect={select}
      />,
    )
    const input = screen.getByRole('combobox', { name: 'Search chats' })
    const options = screen.getAllByRole('option')

    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(select).toHaveBeenCalledWith('second')
  })

  it('wraps arrow navigation and exposes the shared Esc control', () => {
    const close = vi.fn()
    render(
      <ChatSearch
        chats={[chat('first', 'First chat', 3), chat('second', 'Second chat', 2)]}
        now={4}
        onClose={close}
        onSelect={() => undefined}
      />,
    )
    const input = screen.getByRole('combobox', { name: 'Search chats' })
    const options = screen.getAllByRole('option')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(close).toHaveBeenCalledOnce()
  })
})
