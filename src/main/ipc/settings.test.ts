import type { BrowserWindow, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as window from '../window.js'
import { close, open } from './settings.js'

const sender = {} as WebContents

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('settings IPC', () => {
  it('opens the settings window', () => {
    const openWindow = vi
      .spyOn(window, 'openSettings')
      .mockReturnValue({} as BrowserWindow)

    expect(open()).toEqual({ ok: true, value: undefined })
    expect(openWindow).toHaveBeenCalledOnce()
  })

  it('closes the settings window for its own renderer', () => {
    const closeWindow = vi.spyOn(window, 'closeSettings').mockReturnValue(true)

    expect(close(sender)).toEqual({ ok: true, value: undefined })
    expect(closeWindow).toHaveBeenCalledWith(sender)
  })

  it('returns settings/not-owner for a renderer that does not own the window', () => {
    vi.spyOn(window, 'closeSettings').mockReturnValue(false)

    expect(close(sender)).toMatchObject({ ok: false, code: 'settings/not-owner' })
  })

  it('does not leak which window asked into the error message', () => {
    vi.spyOn(window, 'closeSettings').mockReturnValue(false)

    const result = close(sender)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('only the Settings window can finish closing')
  })
})
