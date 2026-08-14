// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatDelta, ChatFailure } from '../../../shared/ipc.js'
import type { Conversation } from '../../../shared/types.js'
import { ok } from '../../../shared/result.js'
import {
  applyDelta,
  applyDeltas,
  applyFinal,
  mergeChats,
  queueDelta,
  useChats,
} from './use-chats.js'

function chat(status: 'streaming' | 'complete' = 'streaming'): Conversation {
  return {
    id: 'chat-1',
    title: 'Chat',
    draft: '',
    mode: 'fast',
    pinned: false,
    updatedAt: 1,
    messages: [
      { id: 'assistant-1', role: 'assistant', text: '', status, at: 1, attachments: [] },
    ],
  }
}

describe('stream event reducers', () => {
  it('ignores an out-of-order delta', () => {
    const current = applyDelta([chat()], {
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
      })[0]?.messages[0],
    ).toMatchObject({ text: 'Hello', reasoning: 'Checked it', streamSeq: 2 })
  })

  it('ignores a late delta after completion', () => {
    const completed = applyFinal([chat()], {
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
      })[0]?.messages[0]?.text,
    ).toBe('Done')
  })

  it('keeps streamed text through an unrelated full-list broadcast', () => {
    const current = applyDelta([chat()], {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: 'Partial',
      reasoning: 'Working',
      seq: 1,
    })
    expect(mergeChats(current, [chat()])[0]?.messages[0]).toMatchObject({
      text: 'Partial',
      reasoning: 'Working',
      streamSeq: 1,
    })
  })

  it('keeps a locally edited draft through an unrelated full-list broadcast', () => {
    const current = [{ ...chat(), draft: 'unfinished thought' }]
    expect(mergeChats(current, [chat()])[0]?.draft).toBe('unfinished thought')
  })

  it('accepts persisted completion over local streaming state', () => {
    const current = applyDelta([chat()], {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: 'Partial',
      reasoning: '',
      seq: 1,
    })
    const incoming = chat('complete')
    incoming.messages = incoming.messages.map((message) => ({ ...message, text: 'Complete' }))
    expect(mergeChats(current, [incoming])[0]?.messages[0]).toMatchObject({
      text: 'Complete',
      status: 'complete',
    })
  })

  it('deduplicates the same conversation across an invoke and broadcast race', () => {
    expect(mergeChats([chat()], [chat(), chat()])).toHaveLength(1)
  })

  it('coalesces uneven provider chunks to the newest update in a frame', () => {
    const pending = new Map<string, ChatDelta>()
    queueDelta(pending, {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: 'H',
      reasoning: '',
      seq: 1,
    })
    queueDelta(pending, {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: 'Hello',
      reasoning: 'Done checking',
      seq: 3,
    })
    queueDelta(pending, {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: 'Hel',
      reasoning: 'Checking',
      seq: 2,
    })
    expect(applyDeltas([chat()], pending.values())[0]?.messages[0]).toMatchObject({
      text: 'Hello',
      reasoning: 'Done checking',
      streamSeq: 3,
    })
  })
})

/** Captures the main -> renderer subscriptions so a test can push events. */
function bridge(chats: Conversation[]): { fail: (event: ChatFailure) => void } {
  let onError: (event: ChatFailure) => void = () => undefined
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      chats: { list: () => Promise.resolve(ok(chats)) },
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
  it('drops a failed send notice when a different conversation is opened', async () => {
    const other: Conversation = { ...chat('complete'), id: 'chat-2', messages: [] }
    const { fail } = bridge([chat('complete'), other])
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
