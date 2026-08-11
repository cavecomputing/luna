// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ChatDelta } from '../../../shared/ipc.js'
import type { Conversation } from '../../../shared/types.js'
import { applyDelta, applyDeltas, applyFinal, mergeChats, queueDelta } from './use-chats.js'

function chat(status: 'streaming' | 'complete' = 'streaming'): Conversation {
  return {
    id: 'chat-1',
    title: 'Chat',
    draft: '',
    icon: 'spark',
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
