import { useEffect, useState } from 'react'
import { emptyModelSlots, type ModelSlots } from '../../../shared/types.js'

/** Mirrors the two model slots owned by main and follows Settings changes live. */
export function useModels(): ModelSlots {
  const [models, setModels] = useState<ModelSlots>(emptyModelSlots)

  useEffect(() => {
    let live = true
    void window.luna.models.get().then((result) => {
      if (live && result.ok) setModels(result.value)
    })
    const stop = window.luna.onModels(setModels)
    return () => {
      live = false
      stop()
    }
  }, [])

  return models
}
