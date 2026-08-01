import type { LunaApi } from '../preload/index.js'

declare global {
  interface Window {
    luna: LunaApi
  }
}

export {}
