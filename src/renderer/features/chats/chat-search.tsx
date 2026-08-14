import type { Conversation } from '../../../shared/types.js'
import { relative } from '../../lib/time.js'
import { useDebouncedValue } from '../../lib/use-debounced-value.js'
import { Dialog, DialogClose, DialogHead } from '../../ui/dialog.js'
import { Pin } from '../../ui/icons/pin.js'
import { SearchInput } from '../../ui/search-input.js'
import { byRecency, filterChats, messageExcerpt } from './filter.js'
import { useEffect, useId, useRef, useState } from 'react'
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
  const [activeId, setActiveId] = useState<string>()
  const options = useRef(new Map<string, HTMLButtonElement>())
  const listId = useId()
  const query = useDebouncedValue(draft, SEARCH_DELAY)
  const results = byRecency(filterChats(chats, query))
  const activeIndex = Math.max(0, results.findIndex((chat) => chat.id === activeId))
  const active = results[activeIndex]

  useEffect(() => {
    if (active !== undefined) options.current.get(active.id)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  function selectActive(): void {
    if (active !== undefined) onSelect(active.id)
  }

  function move(step: -1 | 1): void {
    if (results.length === 0) return
    const next = (activeIndex + step + results.length) % results.length
    setActiveId(results[next]?.id)
  }

  return (
    <Dialog label="Search chats" onClose={onClose} frameClassName={styles.frame}>
      <DialogHead>
        <SearchInput
          value={draft}
          onChange={setDraft}
          placeholder="Search chats"
          autoFocus
          controls={listId}
          activeDescendant={active === undefined ? undefined : `${listId}-${active.id}`}
          onEnter={selectActive}
          onMove={move}
        />
        <DialogClose label="Close search" onClick={onClose} />
      </DialogHead>

      <div
        id={listId}
        className={styles.results}
        role="listbox"
        aria-label="Matching conversations"
        tabIndex={-1}
      >
        {results.map((chat) => {
          const excerpt = messageExcerpt(chat, query)
          return (
            <button
              key={chat.id}
              type="button"
              className={styles.result}
              role="option"
              id={`${listId}-${chat.id}`}
              aria-selected={chat.id === active?.id}
              tabIndex={-1}
              ref={(element) => {
                if (element === null) options.current.delete(chat.id)
                else options.current.set(chat.id, element)
              }}
              onMouseEnter={() => {
                setActiveId(chat.id)
              }}
              onClick={() => {
                onSelect(chat.id)
              }}
            >
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
