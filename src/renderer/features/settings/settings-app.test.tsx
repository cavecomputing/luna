// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

type BridgeOptions = {
  setModel?: ReturnType<typeof vi.fn>
  close?: ReturnType<typeof vi.fn>
  onClose?: (fn: () => void) => () => void
}

function bridge({
  setModel = vi.fn(() => Promise.resolve({ ok: true as const, value: slots })),
  close = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
  onClose = () => () => undefined,
}: BridgeOptions = {}): void {
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
        set: setModel,
      },
      settings: {
        close,
      },
      onPrefs: () => () => undefined,
      onProviders: () => () => undefined,
      onModels: () => () => undefined,
      onSettingsClose: onClose,
    },
  })
}

afterEach(() => {
  cleanup()
})

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

  it('does not offer a system prompt control', () => {
    bridge()
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))

    expect(screen.queryByRole('textbox', { name: /system prompt/i })).toBeNull()
    expect(screen.queryByText('System prompt')).toBeNull()
  })

  it('saves the latest model draft when Settings closes before the debounce', async () => {
    let requestClose: (() => void) | undefined
    let finishSave: (() => void) | undefined
    const setModel = vi.fn(
      () =>
        new Promise<{ ok: true; value: ModelSlots }>((resolve) => {
          finishSave = () => {
            resolve({ ok: true, value: slots })
          }
        }),
    )
    const close = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
    bridge({
      setModel,
      close,
      onClose: (fn) => {
        requestClose = fn
        return () => undefined
      },
    })
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    const expert = (await screen.findAllByPlaceholderText('Select or type a model ID'))[1]
    expect(expert).toBeDefined()
    if (expert === undefined) throw new Error('Expert model input was missing')
    fireEvent.change(expert, { target: { value: 'gpt-expert' } })
    expect(requestClose).toBeDefined()
    requestClose?.()

    await waitFor(() => {
      expect(setModel).toHaveBeenCalledWith('expert', 'openai', 'gpt-expert')
    })
    expect(close).not.toHaveBeenCalled()
    expect(finishSave).toBeDefined()
    finishSave?.()
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce()
    })
  })
})
