// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModeSwitch } from './mode-switch.js'
import { defaultSamplerSettings } from '../../../shared/types.js'

describe('ModeSwitch', () => {
  it('identifies the configured model in each mode tooltip', () => {
    render(
      <ModeSwitch
        value="fast"
        models={{
          fast: { providerId: 'provider-1', model: 'fast-model', sampling: { ...defaultSamplerSettings } },
          expert: { providerId: 'provider-1', model: 'expert-model', sampling: { ...defaultSamplerSettings } },
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('radio', { name: 'Fast' }).getAttribute('data-tooltip')).toBe(
      'Fast model: fast-model',
    )
    expect(screen.getByRole('radio', { name: 'Expert' }).getAttribute('data-tooltip')).toBe(
      'Expert model: expert-model',
    )
    expect(screen.getByRole('radiogroup', { name: 'Response mode' }).getAttribute('data-size')).toBe(
      'compact',
    )
  })
})
