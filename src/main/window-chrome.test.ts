import { describe, expect, it } from 'vitest'
import { background, chromeOptions, overlay, settingsMinimum } from './window-chrome.js'

describe('window chrome', () => {
  it('puts Windows controls over the shared title bar', () => {
    expect(chromeOptions('win32', 'luna-light')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#eef0f4',
        symbolColor: '#14161a',
        height: 44,
      },
    })
  })

  it('keeps the macOS inset title bar and traffic lights', () => {
    expect(chromeOptions('darwin', 'luna-light')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
    })
  })

  it('uses dark colors for the Windows overlay', () => {
    expect(background('luna-dark')).toBe('#16181d')
    expect(overlay('luna-dark')).toEqual({
      color: '#101216',
      symbolColor: '#f2f4f7',
      height: 44,
    })
  })

  it('colors native chrome after each named theme, not just its brightness', () => {
    expect(background('gruvbox-light')).toBe('#fbf1c7')
    expect(overlay('gruvbox-light')).toEqual({
      color: '#f2e5bc',
      symbolColor: '#3c3836',
      height: 44,
    })
    expect(background('gruvbox-dark')).toBe('#282828')
    expect(overlay('gruvbox-dark')).toEqual({
      color: '#282828',
      symbolColor: '#ebdbb2',
      height: 44,
    })
  })

  it('lets the modal backdrop show beneath Windows caption controls', () => {
    expect(overlay('luna-light', true)).toEqual({
      color: '#00000000',
      symbolColor: '#6b7280',
      height: 44,
    })
  })

  it('leaves Linux window chrome native', () => {
    expect(chromeOptions('linux', 'luna-light')).toEqual({})
  })

  it('keeps Windows Settings large enough to clear its caption controls', () => {
    expect(settingsMinimum('win32')).toEqual({ width: 800, height: 580 })
    expect(settingsMinimum('darwin')).toEqual({ width: 640, height: 460 })
  })
})
