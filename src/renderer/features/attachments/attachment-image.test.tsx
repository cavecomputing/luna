// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentImage } from './attachment-image.js'

describe('AttachmentImage', () => {
  it('loads image bytes lazily and revokes its object URL', async () => {
    const create = vi.fn(() => 'blob:preview')
    const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    Object.defineProperty(window, 'luna', {
      configurable: true,
      value: {
        attachments: {
          read: () => Promise.resolve({
            ok: true,
            value: { mediaType: 'image/png', data: Uint8Array.from([1, 2]) },
          }),
        },
      },
    })
    const { unmount } = render(
      <AttachmentImage
        conversationId="chat-1"
        attachment={{
          id: 'file-1',
          name: 'image.png',
          kind: 'image',
          mediaType: 'image/png',
          size: 2,
        }}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'image.png' }).getAttribute('src')).toBe('blob:preview')
    })
    unmount()
    expect(create).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })
})
