import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/ipc.js'
import type { Result } from '../../shared/result.js'

/** Proves the renderer -> preload -> main round trip. */
export function useAppInfo(): Result<AppInfo> | undefined {
  const [info, setInfo] = useState<Result<AppInfo>>()

  useEffect(() => {
    let live = true
    void window.luna.app.info().then((r) => {
      if (live) setInfo(r)
    })
    return () => {
      live = false
    }
  }, [])

  return info
}
