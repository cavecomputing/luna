import { describe, expect, it } from 'vitest'
import { background, chromeOptions, overlay } from './window-chrome.js'

describe('window chrome', () => {
  it('puts Windows controls over the shared title bar', () => {
    expect(chromeOptions('win32', false)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#eef0f4',
        symbolColor: '#14161a',
        height: 52,
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
      height: 52,
    })
  })

  it('leaves Linux window chrome native', () => {
    expect(chromeOptions('linux', false)).toEqual({})
  })
})
