import type { Conversation } from '../../../shared/types.js'
import { relative } from '../../lib/time.js'
import { useDebouncedValue } from '../../lib/use-debounced-value.js'
import { ChatGlyph } from '../../ui/chat-glyph.js'
import { Dialog, DialogHead } from '../../ui/dialog.js'
import { IconButton } from '../../ui/icon-button.js'
import { Pin } from '../../ui/icons/pin.js'
import { X } from '../../ui/icons/x.js'
import { SearchInput } from '../../ui/search-input.js'
import { byRecency, filterChats, messageExcerpt } from './filter.js'
import { useState } from 'react'
import styles from './chat-search.module.css'

const SEARCH_DELAY = 150

type Props = {
  chats: Conversation[]
  now: number
  onClose: () => void
  onSelect: (id: string) => void
}

export function ChatSearch({ chats, now, onClose, onSelect }: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const query = useDebouncedValue(draft, SEARCH_DELAY)
  const results = byRecency(filterChats(chats, query))

  function selectFirst(): void {
    const first = results[0]
    if (first !== undefined) onSelect(first.id)
  }

  return (
    <Dialog label="Search chats" placement="center" onClose={onClose} frameClassName={styles.frame}>
      <DialogHead>
        <SearchInput
          value={draft}
          onChange={setDraft}
          placeholder="Search chats"
          autoFocus
          onEnter={selectFirst}
        />
        <IconButton label="Close search" onClick={onClose}>
          <X />
        </IconButton>
      </DialogHead>

      <div className={styles.results} role="listbox" aria-label="Matching conversations">
        {results.map((chat) => {
          const excerpt = messageExcerpt(chat, query)
          return (
            <button
              key={chat.id}
              type="button"
              className={styles.result}
              role="option"
              aria-selected="false"
              onClick={() => {
                onSelect(chat.id)
              }}
            >
              <span className={styles.glyph}>
                <ChatGlyph icon={chat.icon} />
              </span>
              <span className={styles.resultText}>
                <span className={styles.title}>{chat.title}</span>
                {excerpt !== undefined && <span className={styles.excerpt}>{excerpt}</span>}
                <span className={styles.when}>{relative(chat.updatedAt, now)}</span>
              </span>
              {chat.pinned && (
                <span className={styles.pin} aria-label="Pinned">
                  <Pin size={14} />
                </span>
              )}
            </button>
          )
        })}

        {results.length === 0 && <p className={styles.empty}>No matching chats</p>}
      </div>
    </Dialog>
  )
}
