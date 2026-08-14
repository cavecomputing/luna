// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectMenu } from './select-menu.js'

afterEach(cleanup)

describe('SelectMenu', () => {
  it('selects an option from the app-styled listbox', () => {
    const onChange = vi.fn()
    render(
      <SelectMenu
        label="Fast provider"
        value="openai"
        placeholder="Choose a provider"
        options={[
          { value: 'openai', label: 'OpenAI' },
          { value: 'local', label: 'Local llama.cpp' },
        ]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Fast provider' }))
    expect(screen.getByRole('listbox', { name: 'Fast provider options' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'Local llama.cpp' }))

    expect(onChange).toHaveBeenCalledWith('local')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('supports arrow-key selection', () => {
    const onChange = vi.fn()
    render(
      <SelectMenu
        label="Conversation API"
        value="responses"
        placeholder="Choose an API"
        options={[
          { value: 'responses', label: 'Responses API' },
          { value: 'chat-completions', label: 'Chat Completions' },
        ]}
        onChange={onChange}
      />,
    )

    const menu = screen.getByRole('combobox', { name: 'Conversation API' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('chat-completions')
  })
})
