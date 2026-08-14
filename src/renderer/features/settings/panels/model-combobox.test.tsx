// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelCombobox } from './model-combobox.js'

afterEach(cleanup)

describe('ModelCombobox', () => {
  it('keeps free-form model IDs while showing app-styled suggestions', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ModelCombobox
        value=""
        models={[{ id: 'qwen3-8b' }, { id: 'llama-3.3-70b' }]}
        disabled={false}
        placeholder="Select or type a model ID"
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Model' })
    fireEvent.change(input, { target: { value: 'custom/model' } })
    expect(onChange).toHaveBeenCalledWith('custom/model')

    rerender(
      <ModelCombobox
        value="qwen"
        models={[{ id: 'qwen3-8b' }, { id: 'llama-3.3-70b' }]}
        disabled={false}
        placeholder="Select or type a model ID"
        onChange={onChange}
      />,
    )
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('option', { name: 'qwen3-8b' }))

    expect(onChange).toHaveBeenCalledWith('qwen3-8b')

    fireEvent.click(screen.getByRole('button', { name: 'Show model suggestions' }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
})
