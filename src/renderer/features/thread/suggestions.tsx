import type { Suggestion } from '../../../shared/types.js'
import { ChatGlyph } from '../../ui/chat-glyph.js'
import { ChevronRight } from '../../ui/icons/chevron-right.js'
import styles from './suggestions.module.css'

type Props = {
  items: Suggestion[]
  onPick: (label: string) => void
}

/** Follow-up prompts under the last assistant message. */
export function Suggestions({ items, onPick }: Props): React.JSX.Element | null {
  if (items.length === 0) return null

  return (
    <div className={styles.wrap} aria-label="Suggested follow-ups">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={styles.chip}
          onClick={() => {
            onPick(item.label)
          }}
        >
          <span className={styles.glyph}>
            <ChatGlyph icon={item.icon} size={14} />
          </span>
          <span className={styles.label}>{item.label}</span>
          <span className={styles.go}>
            <ChevronRight size={14} />
          </span>
        </button>
      ))}
    </div>
  )
}
