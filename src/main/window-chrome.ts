import type { BrowserWindowConstructorOptions, TitleBarOverlay } from 'electron'

const TITLE_BAR_HEIGHT = 52

const LIGHT_BACKGROUND = '#f5f6f8'
const DARK_BACKGROUND = '#16181d'

const LIGHT_TITLE_BAR = '#eef0f4'
const DARK_TITLE_BAR = '#101216'

const LIGHT_SYMBOL = '#14161a'
const DARK_SYMBOL = '#f2f4f7'

type ChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarOverlay' | 'titleBarStyle' | 'trafficLightPosition'
>

export function background(dark: boolean): string {
  return dark ? DARK_BACKGROUND : LIGHT_BACKGROUND
}

export function overlay(dark: boolean): TitleBarOverlay {
  return {
    color: dark ? DARK_TITLE_BAR : LIGHT_TITLE_BAR,
    symbolColor: dark ? DARK_SYMBOL : LIGHT_SYMBOL,
    height: TITLE_BAR_HEIGHT,
  }
}

/** Platform-native controls over Luna's shared draggable title-bar row. */
export function chromeOptions(platform: NodeJS.Platform, dark: boolean): ChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
    }
  }

  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: overlay(dark),
    }
  }

  return {}
}
