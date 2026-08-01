import { useEffect, useRef } from 'react'
import { IconButton } from '../../ui/icon-button.js'
import { Paperclip } from '../../ui/icons/paperclip.js'
import { Send } from '../../ui/icons/send.js'
import { useComposer } from './use-composer.js'
import styles from './composer.module.css'

const MAX_ROWS_PX = 160

type Props = {
  onSend: (text: string) => void
  /** Seeded from a suggestion chip. Explicitly undefined when cleared. */
  draft?: string | undefined
}

export function Composer({ onSend, draft }: Props): React.JSX.Element {
  const composer = useComposer(onSend)
  const box = useRef<HTMLTextAreaElement>(null)
  const { setDraft } = composer

  useEffect(() => {
    if (draft !== undefined && draft !== '') {
      setDraft(draft)
      box.current?.focus()
    }
  }, [draft, setDraft])

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
        <IconButton label="Attach a file">
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
          label="Send"
          variant="accent"
          size="lg"
          disabled={!composer.canSend}
          onClick={composer.submit}
        >
          <Send />
        </IconButton>
      </div>
    </div>
  )
}
