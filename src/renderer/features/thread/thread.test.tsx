// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../shared/types.js'
import { Thread } from './thread.js'

const chat: Conversation = {
  id: 'chat-1',
  title: 'Chat',
  draft: '',
  icon: 'spark',
  mode: 'fast',
  pinned: false,
  updatedAt: 1,
  messages: [
    { id: 'message-1', role: 'assistant', text: 'Answer', status: 'complete', at: 1 },
  ],
}

describe('Thread', () => {
  it('offers a jump without forcing a reader away from history', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const { container } = render(<Thread chat={chat} />)
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
})
