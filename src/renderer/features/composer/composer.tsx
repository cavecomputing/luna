import { useEffect, useRef, useState } from 'react'
import { formatBytes } from '../../../shared/attachments.js'
import type { AttachmentMeta, ModelSlots, Mode } from '../../../shared/types.js'
import { AttachmentImage } from '../attachments/attachment-image.js'
import { ModeSwitch } from '../mode/mode-switch.js'
import { IconButton } from '../../ui/icon-button.js'
import { Paperclip } from '../../ui/icons/paperclip.js'
import { Send } from '../../ui/icons/send.js'
import { Stop } from '../../ui/icons/stop.js'
import { X } from '../../ui/icons/x.js'
import { useComposer } from './use-composer.js'
import { useAttachments } from './use-attachments.js'
import styles from './composer.module.css'

const MAX_ROWS_PX = 160

type Props = {
  conversationId?: string | undefined
  onEnsureConversation: () => Promise<{ id: string } | undefined>
  onSend: (text: string, attachmentIds: string[]) => boolean | Promise<boolean>
  onCancel: () => void | Promise<void>
  streaming: boolean
  initialDraft?: string | undefined
  onDraftChange?: ((draft: string) => void) | undefined
  notice?: string | undefined
  mode: Mode
  models: ModelSlots
  onModeChange: (mode: Mode) => void
}

export function Composer({
  onSend,
  onCancel,
  streaming,
  initialDraft = '',
  onDraftChange = () => undefined,
  notice,
  conversationId,
  onEnsureConversation,
  mode,
  models,
  onModeChange,
}: Props): React.JSX.Element {
  const attachments = useAttachments(conversationId, onEnsureConversation)
  const composer = useComposer(
    async (text) => {
      const sent = await onSend(text, attachments.items.map((item) => item.id))
      if (sent) attachments.clear()
      return sent
    },
    initialDraft,
    onDraftChange,
    attachments.items.length > 0,
    attachments.importing,
  )
  const box = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function addFiles(files: FileList | File[]): void {
    void attachments.add(Array.from(files))
  }

  useEffect(() => {
    function focusComposer(): void {
      box.current?.focus()
    }

    focusComposer()
    window.addEventListener('focus', focusComposer)
    return () => {
      window.removeEventListener('focus', focusComposer)
    }
  }, [])

  // Grow with the text, then scroll rather than pushing the thread off screen.
  useEffect(() => {
    const el = box.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_ROWS_PX))}px`
  }, [composer.draft])

  return (
    <div
      className={styles.bar}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        addFiles(event.dataTransfer.files)
      }}
    >
      <div className={styles.wrap}>
        {dragging && <div className={styles.drop}>Drop files to attach</div>}
        <div className={styles.box}>
          {attachments.items.length > 0 && (
            <div className={styles.tray} aria-label="Draft attachments">
              {attachments.items.map((attachment: AttachmentMeta) => (
                <div key={attachment.id} className={styles.attachment}>
                  {attachment.kind === 'image' ? (
                    <AttachmentImage
                      attachment={attachment}
                      conversationId={conversationId ?? ''}
                      compact
                    />
                  ) : (
                    <span className={styles.badge}>{attachment.kind === 'pdf' ? 'PDF' : 'TXT'}</span>
                  )}
                  <span className={styles.fileText}>
                    <span className={styles.fileName}>{attachment.name}</span>
                    <span className={styles.fileSize}>{formatBytes(attachment.size)}</span>
                  </span>
                  <IconButton
                    label={`Remove ${attachment.name}`}
                    size="sm"
                    onClick={() => {
                      void attachments.remove(attachment.id)
                    }}
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}

          <input
            ref={picker}
            className={styles.picker}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/*,.md,.json,.jsonl,.yaml,.yml,.csv,.tsv,.js,.jsx,.ts,.tsx,.py,.sql,.toml,.ini,.log"
            onChange={(event) => {
              if (event.target.files !== null) addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <textarea
            ref={box}
            className={styles.input}
            rows={1}
            value={composer.draft}
            placeholder="Message Luna…"
            aria-label="Message Luna"
            onChange={(e) => {
              composer.setDraft(e.target.value)
            }}
            onKeyDown={composer.onKeyDown}
            onPaste={(event) => {
              const images = Array.from(event.clipboardData.items).flatMap((item) => {
                if (item.kind !== 'file' || !item.type.startsWith('image/')) return []
                const file = item.getAsFile()
                return file === null ? [] : [file]
              })
              if (images.length === 0) return
              event.preventDefault()
              addFiles(images)
            }}
          />

          <div className={styles.tools}>
            <IconButton
              label="Add attachments"
              size="md"
              disabled={streaming || attachments.importing}
              onClick={() => {
                picker.current?.click()
              }}
            >
              <Paperclip />
            </IconButton>

            <div className={styles.actions}>
              <ModeSwitch value={mode} models={models} onChange={onModeChange} />
              <IconButton
                label={streaming ? 'Stop response' : 'Send'}
                variant="accent"
                size="lg"
                disabled={streaming ? false : !composer.canSend}
                onClick={() => {
                  if (streaming) void onCancel()
                  else void composer.submit()
                }}
              >
                {streaming ? <Stop /> : <Send />}
              </IconButton>
            </div>
          </div>
        </div>
      </div>
      {attachments.importing && <p className={styles.status}>Importing attachments…</p>}
      {(attachments.notice ?? notice) !== undefined && (
        <p className={styles.notice} role="status">{attachments.notice ?? notice}</p>
      )}
    </div>
  )
}
