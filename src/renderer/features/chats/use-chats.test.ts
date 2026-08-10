// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Conversation } from '../../../shared/types.js'
import { useChats } from './use-chats.js'

const chat = (id: string, updatedAt: number): Conversation => ({
  id,
  title: `Chat ${id}`,
  icon: 'spark',
  mode: 'fast',
  updatedAt,
  messages: [],
})

describe('useChats conversation actions', () => {
  it('moves a pinned conversation ahead of newer conversations', () => {
    const { result } = renderHook(() => useChats([chat('new', 2), chat('old', 1)], 'fast'))

    act(() => {
      result.current.togglePinned('old')
    })

    expect(result.current.visible.map((item) => item.id)).toEqual(['old', 'new'])
  })

  it('selects the next conversation after deleting the open one', () => {
    const { result } = renderHook(() => useChats([chat('open', 2), chat('next', 1)], 'fast'))

    act(() => {
      result.current.remove('open')
    })

    expect(result.current.openId).toBe('next')
    expect(result.current.open?.id).toBe('next')
  })

  it('keeps the open conversation when deleting another one', () => {
    const { result } = renderHook(() => useChats([chat('open', 2), chat('other', 1)], 'fast'))

    act(() => {
      result.current.remove('other')
    })

    expect(result.current.openId).toBe('open')
    expect(result.current.visible.map((item) => item.id)).toEqual(['open'])
  })
})
