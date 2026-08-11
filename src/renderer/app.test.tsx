// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../shared/types.js'
import type { Chats } from './features/chats/use-chats.js'
import { ConversationSurface } from './app.js'

vi.mock('./features/composer/composer.js', () => ({
  Composer: () => <div data-testid="composer" />,
}))

function conversation(id: string, text?: string): Conversation {
  return {
    id,
    title: text === undefined ? 'New chat' : 'Existing chat',
    draft: '',
    icon: 'spark',
    mode: 'fast',
    pinned: false,
    updatedAt: 1,
    messages: text === undefined
      ? []
      : [{
          id: `${id}-message`,
          role: 'assistant',
          text,
          status: 'complete',
          at: 1,
          attachments: [],
        }],
  }
}

function chats(open: Conversation): Chats {
  return {
    open,
    openId: open.id,
    streamingMessage: undefined,
    error: undefined,
    send: vi.fn(),
    ensure: vi.fn(),
    cancel: vi.fn(),
    setDraft: vi.fn(),
  } as unknown as Chats
}

describe('ConversationSurface', () => {
  it('fully replaces the previous thread when a new chat opens', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const existing = conversation('existing', 'Previous conversation content')
    const { container, rerender } = render(<ConversationSurface chats={chats(existing)} />)

    rerender(<ConversationSurface chats={chats(conversation('new'))} />)

    expect(screen.queryByText('Previous conversation content')).toBeNull()
    expect(screen.getByText('Hey there! I’m Luna.')).toBeTruthy()
    expect(container.querySelectorAll('article')).toHaveLength(0)
    expect(screen.getAllByTestId('composer')).toHaveLength(1)
  })
})
