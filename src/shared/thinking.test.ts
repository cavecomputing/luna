import { describe, expect, it } from 'vitest'
import { parseThinkingTags } from './thinking.js'

describe('parseThinkingTags', () => {
  it('separates reasoning from the final answer', () => {
    expect(parseThinkingTags('<think>Check the facts.</think>The answer.')).toEqual({
      reasoning: 'Check the facts.',
      text: 'The answer.',
      thinking: false,
    })
  })

  it('handles multiple and case-insensitive thinking blocks', () => {
    expect(parseThinkingTags('<THINK>one</THINK>A<think>two</think>B')).toEqual({
      reasoning: 'onetwo',
      text: 'AB',
      thinking: false,
    })
  })

  it('withholds an opening tag split across stream chunks', () => {
    expect(parseThinkingTags('<thi')).toEqual({ reasoning: '', text: '', thinking: false })
    expect(parseThinkingTags('<think>working')).toEqual({
      reasoning: 'working',
      text: '',
      thinking: true,
    })
  })

  it('withholds a closing tag split across stream chunks', () => {
    expect(parseThinkingTags('<think>working</thi')).toEqual({
      reasoning: 'working',
      text: '',
      thinking: true,
    })
    expect(parseThinkingTags('<think>working</think>done')).toEqual({
      reasoning: 'working',
      text: 'done',
      thinking: false,
    })
  })

  it('passes ordinary angle-bracket text through unchanged', () => {
    expect(parseThinkingTags('Use <strong>care</strong>.').text).toBe(
      'Use <strong>care</strong>.',
    )
  })

  it('releases an incomplete literal opening tag when the response is complete', () => {
    expect(parseThinkingTags('literal <thi', true).text).toBe('literal <thi')
  })

  it('leaves a closing tag that opened nothing in the answer', () => {
    expect(parseThinkingTags('</think>stray')).toEqual({
      reasoning: '',
      text: '</think>stray',
      thinking: false,
    })
  })

  it('treats a second opening tag inside reasoning as literal', () => {
    expect(parseThinkingTags('<think>outer<think>inner</think>answer')).toEqual({
      reasoning: 'outer<think>inner',
      text: 'answer',
      thinking: false,
    })
  })

  it('reports reasoning that never closed as still thinking', () => {
    expect(parseThinkingTags('<think>cut off mid-thought', true)).toEqual({
      reasoning: 'cut off mid-thought',
      text: '',
      thinking: true,
    })
  })

  it('keeps text before and after every block in order', () => {
    expect(parseThinkingTags('a<think>one</think>b<think>two</think>c')).toEqual({
      reasoning: 'onetwo',
      text: 'abc',
      thinking: false,
    })
  })
})
