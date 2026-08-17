// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatDelta, ChatFailure } from '../../../shared/ipc.js'
import type { ConversationSummary, Message } from '../../../shared/types.js'
import { ok } from '../../../shared/result.js'
import {
  applyDelta,
  applyDeltas,
  applyFinal,
  mergeChats,
  queueDelta,
  useChats,
} from './use-chats.js'

function chat(status: 'streaming' | 'complete' = 'streaming'): Message[] {
  return [{ id: 'assistant-1', role: 'assistant', text: '', status, at: 1, attachments: [] }]
}

describe('stream event reducers', () => {
  it('ignores an out-of-order delta', () => {
    const current = applyDelta(chat(), {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: 'Hello',
      reasoning: 'Checked it',
      seq: 2,
    })
    expect(
      applyDelta(current, {
        conversationId: 'chat-1',
        messageId: 'assistant-1',
        text: 'Hel',
        reasoning: 'Checking',
        seq: 1,
      })[0],
    ).toMatchObject({ text: 'Hello', reasoning: 'Checked it', streamSeq: 2 })
  })

  it('ignores a late delta after completion', () => {
    const completed = applyFinal(chat(), {
      conversationId: 'chat-1',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        text: 'Done',
        status: 'complete',
        at: 1,
        attachments: [],
      },
    })
    expect(
      applyDelta(completed, {
        conversationId: 'chat-1',
        messageId: 'assistant-1',
        text: 'late',
        reasoning: '',
        seq: 3,
      })[0]?.text,
    ).toBe('Done')
  })

  it('leaves a message the delta does not name alone', () => {
    const two: Message[] = [
      ...chat(),
      { id: 'assistant-2', role: 'assistant', text: 'other', status: 'streaming', at: 2, attachments: [] },
    ]
    expect(
      applyDelta(two, {
        conversationId: 'chat-1',
        messageId: 'assistant-1',
        text: 'Hello',
        reasoning: '',
        seq: 1,
      })[1]?.text,
    ).toBe('other')
  })

  it('applies a batch in order, keeping the newest sequence', () => {
    const applied = applyDeltas(chat(), [
      { conversationId: 'chat-1', messageId: 'assistant-1', text: 'a', reasoning: '', seq: 1 },
      { conversationId: 'chat-1', messageId: 'assistant-1', text: 'ab', reasoning: '', seq: 2 },
    ])
    expect(applied[0]).toMatchObject({ text: 'ab', streamSeq: 2 })
  })

  it('coalesces uneven provider chunks to the newest update in a frame', () => {
    const pending = new Map<string, ChatDelta>()
    for (const seq of [1, 3, 2]) {
      queueDelta(pending, {
        conversationId: 'chat-1',
        messageId: 'assistant-1',
        text: 'x'.repeat(seq),
        reasoning: '',
        seq,
      })
    }
    expect([...pending.values()]).toHaveLength(1)
    expect(applyDeltas(chat(), pending.values())[0]).toMatchObject({ streamSeq: 3 })
  })
})

describe('mergeChats', () => {
  const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
    id: 'chat-1',
    title: 'Chat',
    draft: '',
    mode: 'fast',
    pinned: false,
    updatedAt: 1,
    ...over,
  })

  it('keeps a locally edited draft through an unrelated broadcast', () => {
    const current = [summary({ draft: 'unfinished thought' })]
    expect(mergeChats(current, [summary()])[0]?.draft).toBe('unfinished thought')
  })

  it('takes the incoming title and timestamp', () => {
    const current = [summary({ title: 'Old' })]
    const merged = mergeChats(current, [summary({ title: 'Renamed', updatedAt: 9 })])
    expect(merged[0]).toMatchObject({ title: 'Renamed', updatedAt: 9 })
  })

  it('deduplicates the same conversation across an invoke and broadcast race', () => {
    expect(mergeChats([summary()], [summary(), summary()])).toHaveLength(1)
  })

  /**
   * The list no longer carries message bodies, so a broadcast cannot disturb
   * the thread being streamed into. That used to need explicit preservation.
   */
  it('carries no message bodies at all', () => {
    const merged = mergeChats([summary()], [summary()])
    expect(merged[0]).not.toHaveProperty('messages')
  })
})

/** Captures the main -> renderer subscriptions so a test can push events. */
function bridge(chats: ConversationSummary[]): { fail: (event: ChatFailure) => void } {
  let onError: (event: ChatFailure) => void = () => undefined
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      chats: {
        list: () => Promise.resolve(ok(chats)),
        // Message bodies are now fetched per conversation rather than arriving
        // with the list, so the hook needs this too.
        messages: () => Promise.resolve(ok([])),
      },
      onChats: () => () => undefined,
      onChatDelta: () => () => undefined,
      onChatDone: () => () => undefined,
      onChatError: (fn: (event: ChatFailure) => void) => {
        onError = fn
        return () => undefined
      },
      onRenameChat: () => () => undefined,
    },
  })
  return {
    fail: (event) => {
      onError(event)
    },
  }
}

describe('useChats', () => {
  const listed = (id: string): ConversationSummary => ({
    id,
    title: 'Chat',
    draft: '',
    mode: 'fast',
    pinned: false,
    updatedAt: 1,
  })

  it('drops a failed send notice when a different conversation is opened', async () => {
    const { fail } = bridge([listed('chat-1'), listed('chat-2')])
    const { result } = renderHook(() => useChats('fast'))

    await waitFor(() => {
      expect(result.current.openId).toBe('chat-1')
    })

    act(() => {
      fail({
        conversationId: 'chat-1',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          text: '',
          status: 'error',
          at: 1,
          attachments: [],
        },
        code: 'chat/rate-limit',
      })
    })
    expect(result.current.error).toBe('The provider rate limit was reached. Try again shortly.')

    act(() => {
      result.current.openChat('chat-2')
    })
    expect(result.current.openId).toBe('chat-2')
    expect(result.current.error).toBeUndefined()
  })
})
