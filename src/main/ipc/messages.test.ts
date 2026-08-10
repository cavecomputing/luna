import { describe, expect, it, vi } from 'vitest'
import type { MessageAction } from '../chats.js'
import { showMessageMenu } from './messages.js'

function deps(status: 'complete' | 'error' = 'complete') {
  return {
    getMessage: vi.fn((id: string) =>
      id === 'message-1'
        ? {
            id,
            role: 'assistant' as const,
            text: 'Complete response',
            status,
            retryable: status === 'error',
          }
        : undefined,
    ),
    retry: vi.fn(),
    show: vi.fn(),
  }
}

describe('message menu', () => {
  it('opens the native menu with stored message text', () => {
    const d = deps()
    expect(showMessageMenu({ id: 'message-1' }, d)).toEqual({ ok: true, value: undefined })
    expect(d.show).toHaveBeenCalledWith(
      {
        id: 'message-1',
        role: 'assistant',
        text: 'Complete response',
        status: 'complete',
        retryable: false,
      },
      expect.any(Function),
    )
  })

  it('connects a failed response menu to retry', () => {
    const d = deps('error')
    d.show.mockImplementation((_message: MessageAction, retry: () => void) => {
      retry()
    })
    showMessageMenu({ id: 'message-1' }, d)
    expect(d.retry).toHaveBeenCalledWith('message-1')
  })

  it('rejects an invalid message id', () => {
    expect(showMessageMenu({ id: '../bad' }, deps())).toMatchObject({
      ok: false,
      code: 'message/invalid',
    })
  })

  it('rejects a missing message', () => {
    expect(showMessageMenu({ id: 'missing' }, deps())).toMatchObject({
      ok: false,
      code: 'message/missing',
    })
  })
})
