import { describe, expect, it } from 'vitest'
import { background, chromeOptions, overlay, settingsMinimum } from './window-chrome.js'

describe('window chrome', () => {
  it('puts Windows controls over the shared title bar', () => {
    expect(chromeOptions('win32', false)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#eef0f4',
        symbolColor: '#14161a',
        height: 44,
      },
    })
  })

  it('keeps the macOS inset title bar and traffic lights', () => {
    expect(chromeOptions('darwin', false)).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
    })
  })

  it('uses dark colors for the Windows overlay', () => {
    expect(background(true)).toBe('#16181d')
    expect(overlay(true)).toEqual({
      color: '#101216',
      symbolColor: '#f2f4f7',
      height: 44,
    })
  })

  it('lets the modal backdrop show beneath Windows caption controls', () => {
    expect(overlay(false, true)).toEqual({
      color: '#00000000',
      symbolColor: '#6b7280',
      height: 44,
    })
  })

  it('leaves Linux window chrome native', () => {
    expect(chromeOptions('linux', false)).toEqual({})
  })

  it('keeps Windows Settings large enough to clear its caption controls', () => {
    expect(settingsMinimum('win32')).toEqual({ width: 800, height: 580 })
    expect(settingsMinimum('darwin')).toEqual({ width: 640, height: 460 })
  })
})
