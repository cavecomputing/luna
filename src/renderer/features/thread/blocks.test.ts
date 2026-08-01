import { describe, expect, it } from 'vitest'
import { toBlocks } from './blocks.js'

describe('toBlocks', () => {
  it('returns nothing for empty text', () => {
    expect(toBlocks('')).toEqual([])
  })

  it('keeps a single paragraph together', () => {
    expect(toBlocks('Hello there')).toEqual([{ kind: 'para', text: 'Hello there' }])
  })

  it('joins wrapped lines into one paragraph', () => {
    expect(toBlocks('one\ntwo')).toEqual([{ kind: 'para', text: 'one two' }])
  })

  it('splits paragraphs on a blank line', () => {
    expect(toBlocks('one\n\ntwo')).toEqual([
      { kind: 'para', text: 'one' },
      { kind: 'para', text: 'two' },
    ])
  })

  it('groups consecutive bullets into one list', () => {
    expect(toBlocks('- a\n- b')).toEqual([{ kind: 'list', items: ['a', 'b'] }])
  })

  it('closes a paragraph when a list starts', () => {
    expect(toBlocks('intro\n- a')).toEqual([
      { kind: 'para', text: 'intro' },
      { kind: 'list', items: ['a'] },
    ])
  })

  it('closes a list when prose resumes', () => {
    expect(toBlocks('- a\nafter')).toEqual([
      { kind: 'list', items: ['a'] },
      { kind: 'para', text: 'after' },
    ])
  })

  it('handles the paragraph, list, paragraph shape of a real reply', () => {
    const out = toBlocks('Happy to help.\n\n- one\n- two\n\nThen this.')
    expect(out).toEqual([
      { kind: 'para', text: 'Happy to help.' },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'para', text: 'Then this.' },
    ])
  })

  it('does not treat a hyphenated word as a bullet', () => {
    expect(toBlocks('well-known')).toEqual([{ kind: 'para', text: 'well-known' }])
  })
})
