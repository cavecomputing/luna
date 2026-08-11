import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from './migrations.js'
import { load, parseBounds, save, visibleOn, type Bounds } from './window-state.js'

const screen: Bounds = { x: 0, y: 0, width: 1440, height: 900 }

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

describe('parseBounds', () => {
  it('rejects malformed database rows', () => {
    expect(parseBounds({ x: 0, y: 0, width: 'wide', height: 720 })).toBeUndefined()
    expect(parseBounds({ x: 0, y: 0, width: -1, height: 720 })).toBeUndefined()
  })
})

describe('visibleOn', () => {
  it('accepts a window with a usable area on a connected display', () => {
    expect(visibleOn({ x: 1320, y: 100, width: 400, height: 500 }, [screen])).toBe(true)
  })

  it('rejects a window stranded off screen', () => {
    expect(visibleOn({ x: 1800, y: 100, width: 800, height: 600 }, [screen])).toBe(false)
  })

  it('rejects a window whose title bar is above the display', () => {
    expect(visibleOn({ x: 100, y: -600, width: 800, height: 700 }, [screen])).toBe(false)
  })
})

describe('window state', () => {
  it('round-trips normal bounds for a window', () => {
    const db = fresh()
    const bounds = { x: 120, y: 80, width: 1100, height: 720 }
    save(db, 'main', bounds)

    expect(load(db, 'main', [screen], { width: 720, height: 480 })).toEqual(bounds)
  })

  it('falls back when saved bounds no longer meet the minimum size', () => {
    const db = fresh()
    save(db, 'settings', { x: 10, y: 10, width: 500, height: 400 })

    expect(load(db, 'settings', [screen], { width: 640, height: 460 })).toBeUndefined()
  })

  it('keeps each window kind independent', () => {
    const db = fresh()
    save(db, 'main', { x: 10, y: 20, width: 1000, height: 700 })
    save(db, 'shortcuts', { x: 40, y: 50, width: 520, height: 500 })

    expect(load(db, 'main', [screen], { width: 720, height: 480 })?.x).toBe(10)
    expect(load(db, 'shortcuts', [screen], { width: 420, height: 420 })?.x).toBe(40)
  })
})
