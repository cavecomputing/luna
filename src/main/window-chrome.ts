import type { BrowserWindowConstructorOptions, TitleBarOverlay } from 'electron'
import type { Theme } from '../shared/prefs.js'

const TITLE_BAR_HEIGHT = 44

type ChromeColors = {
  /** Pre-paint window background; sits between --bg and --surface. */
  background: string
  /** Windows caption strip; matches the theme's --bg. */
  titleBar: string
  symbol: string
}

/**
 * Native chrome follows the named theme, not just its brightness — a Gruvbox
 * window behind a Luna-grey caption strip reads as a bug. Hexes mirror the
 * theme's tokens in renderer/styles/tokens.css.
 */
const chrome: Record<Theme, ChromeColors> = {
  'luna-light': { background: '#f5f6f8', titleBar: '#eef0f4', symbol: '#14161a' },
  'luna-dark': { background: '#16181d', titleBar: '#101216', symbol: '#f2f4f7' },
  'gruvbox-light': { background: '#fbf1c7', titleBar: '#f2e5bc', symbol: '#3c3836' },
  'gruvbox-dark': { background: '#282828', titleBar: '#282828', symbol: '#ebdbb2' },
}

const MODAL_SYMBOL = '#6b7280'

type ChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarOverlay' | 'titleBarStyle' | 'trafficLightPosition'
>

type MinimumSize = {
  width: number
  height: number
}

export function background(theme: Theme): string {
  return chrome[theme].background
}

export function overlay(theme: Theme, modal = false): TitleBarOverlay {
  return {
    color: modal ? '#00000000' : chrome[theme].titleBar,
    symbolColor: modal ? MODAL_SYMBOL : chrome[theme].symbol,
    height: TITLE_BAR_HEIGHT,
  }
}

/** Windows caption controls need the full Settings chrome at its designed size. */
export function settingsMinimum(platform: NodeJS.Platform): MinimumSize {
  return platform === 'win32' ? { width: 800, height: 580 } : { width: 640, height: 460 }
}

/** Platform-native controls over Luna's shared draggable title-bar row. */
export function chromeOptions(platform: NodeJS.Platform, theme: Theme): ChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
    }
  }

  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: overlay(theme),
    }
  }

  return {}
}
