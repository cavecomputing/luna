import { useEffect, useState } from 'react'
import { MAX_ATTACHMENT_BYTES } from '../../../shared/attachments.js'
import type { AttachmentRejection } from '../../../shared/ipc.js'
import type { AttachmentMeta } from '../../../shared/types.js'

type ConversationRef = { id: string }

function rejectionText(rejections: AttachmentRejection[]): string | undefined {
  if (rejections.length === 0) return undefined
  const code = rejections[0]?.code
  const reason =
    code === 'attachment/io'
      ? 'One or more files could not be read.'
      : code === 'attachment/too-large'
      ? 'Files must be 10 MiB or smaller.'
      : code === 'attachment/too-many'
        ? 'A message can include up to five attachments.'
        : code === 'attachment/message-too-large'
          ? 'Attachments in one message can total up to 20 MiB.'
          : code === 'attachment/conversation-too-large'
            ? 'This conversation has reached its 50 MiB attachment limit.'
            : code === 'attachment/animated-gif'
              ? 'Animated GIFs are not supported.'
              : 'One or more files use an unsupported format.'
  return rejections.length === 1 ? reason : `${reason} ${String(rejections.length)} files were skipped.`
}

export function useAttachments(
  conversationId: string | undefined,
  ensure: () => Promise<ConversationRef | undefined>,
) {
  const [items, setItems] = useState<AttachmentMeta[]>([])
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    let alive = true
    if (conversationId === undefined) {
      return () => {
        alive = false
      }
    }
    void window.luna.attachments.list(conversationId).then((result) => {
      if (!alive) return
      if (result.ok) setItems(result.value)
      else setNotice('Attachments could not be loaded.')
    })
    const off = window.luna.onAttachments((event) => {
      if (event.conversationId === conversationId) setItems(event.attachments)
    })
    return () => {
      alive = false
      off()
    }
  }, [conversationId])

  async function add(files: File[]): Promise<void> {
    if (files.length === 0 || importing) return
    setImporting(true)
    setNotice(undefined)
    const conversation = await ensure()
    if (conversation === undefined) {
      setImporting(false)
      setNotice('A conversation could not be created for these attachments.')
      return
    }

    const rejections: AttachmentRejection[] = []
    for (const file of files.slice(0, 20)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        rejections.push({ name: file.name, code: 'attachment/too-large' })
        continue
      }
      try {
        const result = await window.luna.attachments.add(conversation.id, [
          {
            name: file.name,
            mediaType: file.type,
            data: new Uint8Array(await file.arrayBuffer()),
          },
        ])
        if (result.ok) {
          setItems((current) => {
            const known = new Set(current.map((item) => item.id))
            return [...current, ...result.value.accepted.filter((item) => !known.has(item.id))]
          })
          rejections.push(...result.value.rejected)
        } else {
          rejections.push({ name: file.name, code: result.code })
        }
      } catch {
        rejections.push({ name: file.name, code: 'attachment/io' })
      }
    }
    setNotice(rejectionText(rejections))
    setImporting(false)
  }

  async function remove(id: string): Promise<void> {
    if (conversationId === undefined) return
    const result = await window.luna.attachments.remove(conversationId, id)
    if (result.ok) {
      setItems((current) => current.filter((item) => item.id !== id))
    } else {
      setNotice('The attachment could not be removed.')
    }
  }

  return {
    items,
    importing,
    notice,
    add,
    remove,
    clear: () => {
      setItems([])
      setNotice(undefined)
    },
  }
}
