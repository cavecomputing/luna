import { useEffect, useRef } from 'react'
import { IconButton } from '../../ui/icon-button.js'
import { Paperclip } from '../../ui/icons/paperclip.js'
import { Send } from '../../ui/icons/send.js'
import { Stop } from '../../ui/icons/stop.js'
import { useComposer } from './use-composer.js'
import styles from './composer.module.css'

const MAX_ROWS_PX = 160

type Props = {
  onSend: (text: string) => boolean | Promise<boolean>
  onCancel: () => void | Promise<void>
  streaming: boolean
  initialDraft?: string | undefined
  onDraftChange?: ((draft: string) => void) | undefined
  notice?: string | undefined
}

export function Composer({
  onSend,
  onCancel,
  streaming,
  initialDraft = '',
  onDraftChange = () => undefined,
  notice,
}: Props): React.JSX.Element {
  const composer = useComposer(onSend, initialDraft, onDraftChange)
  const box = useRef<HTMLTextAreaElement>(null)

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
    <div className={styles.bar}>
      <div className={styles.box}>
        <IconButton label="Attachments are coming later" disabled>
          <Paperclip />
        </IconButton>

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
        />

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
      {notice !== undefined && <p className={styles.notice}>{notice}</p>}
    </div>
  )
}
