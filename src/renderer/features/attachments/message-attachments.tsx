import { formatBytes } from '../../../shared/attachments.js'
import type { AttachmentMeta } from '../../../shared/types.js'
import { AttachmentImage } from './attachment-image.js'
import styles from './message-attachments.module.css'

type Props = {
  attachments: AttachmentMeta[]
  conversationId: string
}

export function MessageAttachments({ attachments, conversationId }: Props): React.JSX.Element {
  return (
    <div className={styles.list} aria-label="Attachments">
      {attachments.map((attachment) =>
        attachment.kind === 'image' ? (
          <figure key={attachment.id} className={styles.imageCard}>
            <AttachmentImage attachment={attachment} conversationId={conversationId} />
            <figcaption>{attachment.name}</figcaption>
          </figure>
        ) : (
          <div key={attachment.id} className={styles.file}>
            <span className={styles.badge}>{attachment.kind === 'pdf' ? 'PDF' : 'TXT'}</span>
            <span className={styles.details}>
              <span className={styles.name}>{attachment.name}</span>
              <span className={styles.size}>{formatBytes(attachment.size)}</span>
            </span>
          </div>
        ),
      )}
    </div>
  )
}
