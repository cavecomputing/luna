// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../shared/types.js'
import { ChatItem } from './chat-item.js'

const chat: Conversation = {
  id: 'chat-1',
  title: 'New chat',
  draft: '',
  icon: 'spark',
  mode: 'fast',
  pinned: false,
  updatedAt: 1,
  messages: [],
}

describe('ChatItem', () => {
  it('submits a trimmed inline title while renaming', () => {
    const rename = vi.fn()
    render(
      <ChatItem
        chat={chat}
        active
        renaming
        onSelect={vi.fn()}
        onRename={rename}
        onCancelRename={vi.fn()}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Rename New chat' })
    fireEvent.change(input, { target: { value: '  Project plan  ' } })
    const form = input.closest('form')
    expect(form).not.toBeNull()
    if (form !== null) fireEvent.submit(form)

    expect(rename).toHaveBeenCalledWith('chat-1', 'Project plan')
  })
})
