import { describe, expect, it } from 'vitest'
import { trayMenu } from './tray.js'

describe('trayMenu', () => {
  it('offers exactly one item', () => {
    expect(trayMenu()).toHaveLength(1)
  })

  it('labels that item WIP', () => {
    expect(trayMenu()[0]?.label).toBe('WIP')
  })

  it('leaves the item disabled with no click handler', () => {
    const item = trayMenu()[0]
    expect(item?.enabled).toBe(false)
    expect(item?.click).toBeUndefined()
  })
})
