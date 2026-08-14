// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './composer.js'
import { defaultSamplerSettings } from '../../../shared/types.js'

const models = {
  fast: { providerId: 'provider-1', model: 'fast-model', sampling: { ...defaultSamplerSettings } },
  expert: { providerId: 'provider-1', model: 'expert-model', sampling: { ...defaultSamplerSettings } },
}

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
      mode="fast"
      models={models}
      onModeChange={vi.fn()}
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

describe('Composer toolbar', () => {
  afterEach(cleanup)

  it('keeps response mode beside the send action', () => {
    const onModeChange = vi.fn()
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
        mode="fast"
        models={models}
        onModeChange={onModeChange}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Expert' }))

    expect(onModeChange).toHaveBeenCalledWith('expert')
    expect(screen.getByRole('button', { name: 'Add attachments' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
  })
})
