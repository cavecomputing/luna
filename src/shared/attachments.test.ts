import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  formatBytes,
} from './attachments.js'

describe('attachment limits', () => {
  it('keeps the first release limits explicit', () => {
    expect(MAX_ATTACHMENTS).toBe(5)
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
    expect(MAX_MESSAGE_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024)
    expect(MAX_CONVERSATION_ATTACHMENT_BYTES).toBe(50 * 1024 * 1024)
  })

  it('formats compact file sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MiB')
  })
})
