// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { defaultPrefs } from '../../../shared/prefs.js'
import type { ModelSlots, Provider } from '../../../shared/types.js'
import { SettingsApp } from './settings-app.js'

const provider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  api: 'responses',
  organization: '',
  project: '',
  hasApiKey: false,
}

const slots: ModelSlots = {
  fast: { providerId: 'openai', model: '' },
  expert: { providerId: 'openai', model: '' },
}

function bridge(): void {
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      prefs: {
        get: () => Promise.resolve({ ok: true, value: defaultPrefs }),
        set: () => Promise.resolve({ ok: true, value: defaultPrefs }),
      },
      providers: {
        list: () => Promise.resolve({ ok: true, value: [provider] }),
        models: () => Promise.resolve({ ok: true, value: [] }),
      },
      models: {
        get: () => Promise.resolve({ ok: true, value: slots }),
        set: () => Promise.resolve({ ok: true, value: slots }),
      },
      onPrefs: () => () => undefined,
      onProviders: () => () => undefined,
      onModels: () => () => undefined,
    },
  })
}

describe('SettingsApp', () => {
  it('opens each section at the top instead of retaining the previous scroll offset', () => {
    bridge()
    render(<SettingsApp />)
    const providersPanel = screen.getByRole('main')
    providersPanel.scrollTop = 240

    fireEvent.click(screen.getByRole('button', { name: 'Models' }))

    const modelsPanel = screen.getByRole('main')
    expect(modelsPanel).not.toBe(providersPanel)
    expect(modelsPanel.scrollTop).toBe(0)
  })
})
