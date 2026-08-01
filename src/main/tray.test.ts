import { describe, expect, it, vi } from 'vitest'
import { trayMenu } from './tray.js'

const actions = () => ({ onShow: vi.fn(), onQuit: vi.fn() })

const labels = (items: ReturnType<typeof trayMenu>) =>
  items.filter((i) => i.type !== 'separator').map((i) => i.label)

describe('trayMenu', () => {
  it('offers Show Luna and Quit Luna', () => {
    expect(labels(trayMenu(actions()))).toEqual(['Show Luna', 'Quit Luna'])
  })

  it('wires Show Luna to the open action', () => {
    const a = actions()
    const item = trayMenu(a).find((i) => i.label === 'Show Luna')
    expect(item?.click).toBe(a.onShow)
  })

  it('wires Quit Luna to the quit action', () => {
    const a = actions()
    const item = trayMenu(a).find((i) => i.label === 'Quit Luna')
    expect(item?.click).toBe(a.onQuit)
  })

  it('separates the two so Quit is not a mis-click away', () => {
    expect(trayMenu(actions())[1]?.type).toBe('separator')
  })
})
