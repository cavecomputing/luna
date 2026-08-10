import { describe, expect, it, vi } from 'vitest'
import { showMessageMenu } from './messages.js'

function deps() {
  return {
    getText: vi.fn((id: string) => (id === 'message-1' ? 'Complete response' : undefined)),
    show: vi.fn(),
  }
}

describe('message menu', () => {
  it('opens the native menu with stored message text', () => {
    const d = deps()
    expect(showMessageMenu({ id: 'message-1' }, d)).toEqual({ ok: true, value: undefined })
    expect(d.show).toHaveBeenCalledWith('Complete response')
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
