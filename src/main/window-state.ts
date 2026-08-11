import type { DatabaseSync } from 'node:sqlite'
import { object } from './parse.js'

export type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

export type WindowName = 'main' | 'settings' | 'shortcuts'

type Size = Pick<Bounds, 'width' | 'height'>

const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 80

export function parseBounds(row: unknown): Bounds | undefined {
  const value = object(row)
  if (
    value === undefined ||
    !isInteger(value.x) ||
    !isInteger(value.y) ||
    !isInteger(value.width) ||
    !isInteger(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return undefined
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

export function visibleOn(bounds: Bounds, workAreas: readonly Bounds[]): boolean {
  return workAreas.some((area) => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const lowestUsableTop = area.y + area.height - MIN_VISIBLE_HEIGHT
    return width >= MIN_VISIBLE_WIDTH && bounds.y >= area.y && bounds.y <= lowestUsableTop
  })
}

export function load(
  db: DatabaseSync,
  name: WindowName,
  workAreas: readonly Bounds[],
  minimum: Size,
): Bounds | undefined {
  const bounds = parseBounds(
    db.prepare('SELECT x, y, width, height FROM window_state WHERE name = ?').get(name),
  )
  if (bounds === undefined) return undefined
  if (bounds.width < minimum.width || bounds.height < minimum.height) return undefined
  return visibleOn(bounds, workAreas) ? bounds : undefined
}

export function save(db: DatabaseSync, name: WindowName, bounds: Bounds): void {
  db.prepare(`INSERT INTO window_state (name, x, y, width, height)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET
      x = excluded.x,
      y = excluded.y,
      width = excluded.width,
      height = excluded.height`).run(name, bounds.x, bounds.y, bounds.width, bounds.height)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}
