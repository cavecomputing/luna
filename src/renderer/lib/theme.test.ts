// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { defaultPrefs, type Prefs } from '../../shared/prefs.js'
import { err, ok, type Result } from '../../shared/result.js'
import { watchTheme } from './theme.js'

function bridge(get: () => Promise<Result<Prefs>>): { broadcast: (next: Prefs) => void } {
  const listeners: ((next: Prefs) => void)[] = []
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      prefs: { get },
      onPrefs: (listener: (next: Prefs) => void) => {
        listeners.push(listener)
        return () => undefined
      },
    },
  })
  return {
    broadcast: (next) => {
      for (const listener of listeners) listener(next)
    },
  }
}

describe('watchTheme', () => {
  it('pins the stored theme on the document element', async () => {
    bridge(() => Promise.resolve(ok({ ...defaultPrefs, theme: 'gruvbox-dark' })))
    watchTheme()

    await vi.waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('gruvbox-dark')
    })
  })

  it('follows a theme change announced from another window', async () => {
    const { broadcast } = bridge(() => Promise.resolve(ok(defaultPrefs)))
    watchTheme()

    await vi.waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('luna-light')
    })

    broadcast({ ...defaultPrefs, theme: 'gruvbox-light' })
    expect(document.documentElement.dataset.theme).toBe('gruvbox-light')
  })

  it('leaves the default theme in charge when the read fails', async () => {
    bridge(() => Promise.resolve(err('prefs/read', 'read failed')))
    delete document.documentElement.dataset.theme

    watchTheme()
    await Promise.resolve()

    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
