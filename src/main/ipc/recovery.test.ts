import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../db.js'
import * as recoveryWindow from '../recovery-window.js'
import { quit, recoveryStatus, runAction, setReady } from './recovery.js'

const sender = {} as WebContents

beforeEach(() => {
  vi.spyOn(recoveryWindow, 'owns').mockReturnValue(true)
  vi.spyOn(db, 'recoveryStatus').mockReturnValue({ kind: 'corrupt', backupCreatedAt: 1 })
  setReady(() => Promise.resolve())
})

describe('database recovery IPC', () => {
  it('returns status only to the active recovery window', () => {
    expect(recoveryStatus(sender)).toEqual({
      ok: true,
      value: { kind: 'corrupt', backupCreatedAt: 1 },
    })
    vi.mocked(recoveryWindow.owns).mockReturnValue(false)
    expect(recoveryStatus(sender)).toMatchObject({ ok: false, code: 'recovery/not-active' })
  })

  it('restores and continues normal startup', async () => {
    const restore = vi.spyOn(db, 'restore').mockResolvedValue()
    const finish = vi.spyOn(recoveryWindow, 'finish').mockImplementation(() => undefined)
    const ready = vi.fn(() => Promise.resolve())
    setReady(ready)

    expect(await runAction(sender, 'restore')).toEqual({ ok: true, value: undefined })
    expect(restore).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledOnce()
  })

  it('rejects actions from a normal application window', async () => {
    vi.mocked(recoveryWindow.owns).mockReturnValue(false)
    expect(await runAction(sender, 'restore')).toMatchObject({
      ok: false,
      code: 'recovery/not-active',
    })
  })

  it('returns a stable error when retry still cannot initialize', async () => {
    vi.spyOn(db, 'initialize').mockResolvedValue({ kind: 'migration-failed' })
    expect(await runAction(sender, 'retry')).toMatchObject({
      ok: false,
      code: 'recovery/retry-failed',
    })
  })

  it('starts fresh through the same authorized recovery path', async () => {
    const startFresh = vi.spyOn(db, 'startFresh').mockResolvedValue()
    expect(await runAction(sender, 'start-fresh')).toEqual({ ok: true, value: undefined })
    expect(startFresh).toHaveBeenCalledOnce()
  })

  it('rejects a second action while recovery is busy', async () => {
    let complete: (() => void) | undefined
    vi.spyOn(db, 'restore').mockImplementation(() => new Promise((resolve) => {
      complete = resolve
    }))
    const first = runAction(sender, 'restore')
    expect(await runAction(sender, 'restore')).toMatchObject({
      ok: false,
      code: 'recovery/busy',
    })
    complete?.()
    await first
  })

  it('quits only from the recovery window', () => {
    vi.useFakeTimers()
    expect(quit(sender)).toEqual({ ok: true, value: undefined })
    vi.clearAllTimers()
    vi.useRealTimers()
  })
})
