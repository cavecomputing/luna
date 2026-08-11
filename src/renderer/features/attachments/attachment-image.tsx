import { useEffect, useState } from 'react'
import type { AttachmentMeta } from '../../../shared/types.js'
import styles from './attachment-image.module.css'

type Props = {
  attachment: AttachmentMeta
  conversationId: string
  compact?: boolean
}

export function AttachmentImage({
  attachment,
  conversationId,
  compact = false,
}: Props): React.JSX.Element {
  const [source, setSource] = useState<string>()

  useEffect(() => {
    let alive = true
    let objectUrl: string | undefined
    void window.luna.attachments.read(conversationId, attachment.id).then((result) => {
      if (!alive || !result.ok) return
      const bytes = new Uint8Array(result.value.data.byteLength)
      bytes.set(result.value.data)
      objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.mediaType }))
      setSource(objectUrl)
    })
    return () => {
      alive = false
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id, conversationId])

  return source === undefined ? (
    <div className={compact ? styles.compactPlaceholder : styles.placeholder} aria-hidden="true" />
  ) : (
    <img
      className={compact ? styles.compact : styles.image}
      src={source}
      alt={attachment.name}
      onLoad={() => undefined}
    />
  )
}
