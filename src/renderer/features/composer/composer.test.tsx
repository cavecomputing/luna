// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './composer.js'

function renderComposer(): HTMLTextAreaElement {
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      attachments: {
        list: () => Promise.resolve({ ok: true, value: [] }),
        add: () => Promise.resolve({ ok: true, value: { accepted: [], rejected: [] } }),
        remove: () => Promise.resolve({ ok: true, value: undefined }),
      },
      onAttachments: () => () => undefined,
    },
  })
  render(
    <Composer
      onSend={vi.fn()}
      onEnsureConversation={vi.fn(() => Promise.resolve({ id: 'chat-1' }))}
      onCancel={vi.fn()}
      streaming={false}
    />,
  )
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message Luna' })
}

describe('Composer focus', () => {
  afterEach(cleanup)

  it('focuses the message box when the composer mounts', () => {
    const composer = renderComposer()
    expect(document.activeElement).toBe(composer)
  })

  it('restores message focus when the main window regains focus', () => {
    const composer = renderComposer()
    const other = document.createElement('button')
    document.body.append(other)
    other.focus()
    expect(document.activeElement).toBe(other)

    fireEvent.focus(window)

    expect(document.activeElement).toBe(composer)
  })
})
