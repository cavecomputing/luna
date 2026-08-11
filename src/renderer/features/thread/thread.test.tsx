// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Conversation, Message as Msg } from '../../../shared/types.js'
import { Thread } from './thread.js'

// The entrance itself is CSS; what Thread owns is which messages count as new.
vi.mock('./message.js', () => ({
  Message: ({ message, fresh }: { message: Msg; fresh: boolean }) => (
    <article data-fresh={String(fresh)} data-testid={`message-${message.id}`} />
  ),
}))

function message(id: string): Msg {
  return { id, role: 'user', text: id, status: 'complete', at: 1, attachments: [] }
}

function chat(messages: Msg[]): Conversation {
  return {
    id: 'chat-1',
    title: 'Chat',
    draft: '',
    icon: 'spark',
    mode: 'fast',
    pinned: false,
    updatedAt: 1,
    messages,
  }
}

describe('Thread', () => {
  it('offers a jump without forcing a reader away from history', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const { container } = render(
      <Thread
        chat={{
          id: 'chat-1',
          title: 'Chat',
          draft: '',
          icon: 'spark',
          mode: 'fast',
          pinned: false,
          updatedAt: 1,
          messages: [
            {
              id: 'message-1',
              role: 'assistant',
              text: 'Answer',
              status: 'complete',
              at: 1,
              attachments: [],
            },
          ],
        }}
      />,
    )
    const scroll = container.firstElementChild?.firstElementChild
    if (!(scroll instanceof HTMLElement)) throw new Error('missing thread scroller')
    Object.defineProperties(scroll, {
      scrollTop: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 1400 },
    })

    fireEvent.scroll(scroll)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest ↓' }))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
  })

  it('keeps loaded history still but animates messages that arrive later', () => {
    const { rerender } = render(<Thread chat={chat([message('one')])} />)

    expect(screen.getByTestId('message-one').dataset.fresh).toBe('false')

    rerender(<Thread chat={chat([message('one'), message('two')])} />)

    expect(screen.getByTestId('message-one').dataset.fresh).toBe('false')
    expect(screen.getByTestId('message-two').dataset.fresh).toBe('true')
  })

  it('treats a reopened conversation as history again', () => {
    const first = chat([message('three'), message('four')])
    const { rerender } = render(<Thread key="a" chat={first} />)

    rerender(<Thread key="b" chat={first} />)

    expect(screen.getByTestId('message-three').dataset.fresh).toBe('false')
    expect(screen.getByTestId('message-four').dataset.fresh).toBe('false')
  })
})
