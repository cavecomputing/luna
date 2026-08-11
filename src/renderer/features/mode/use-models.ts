import { useEffect, useState } from 'react'
import type { ModelSlots } from '../../../shared/types.js'

const empty: ModelSlots = {
  fast: { providerId: null, model: '' },
  expert: { providerId: null, model: '' },
}

/** Mirrors the two model slots owned by main and follows Settings changes live. */
export function useModels(): ModelSlots {
  const [models, setModels] = useState<ModelSlots>(empty)

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
