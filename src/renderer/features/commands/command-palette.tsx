import { useEffect, useId, useRef, useState } from 'react'
import { shortcutKeys } from '../../../shared/keyboard-shortcuts.js'
import { Dialog, DialogClose, DialogHead } from '../../ui/dialog.js'
import { SearchInput } from '../../ui/search-input.js'
import { filterCommands, type Command } from './commands.js'
import styles from './command-palette.module.css'

type Props = {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string>()
  const options = useRef(new Map<string, HTMLButtonElement>())
  const listId = useId()
  // No debounce: this filters a handful of strings already in memory, so the
  // delay search needs for scanning message text would only add latency here.
  const results = filterCommands(commands, query)
  const activeIndex = Math.max(0, results.findIndex((command) => command.id === activeId))
  const active = results[activeIndex]

  useEffect(() => {
    if (active !== undefined) options.current.get(active.id)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  /** Close first, so a command that opens another surface isn't undone by it. */
  function run(command: Command | undefined): void {
    if (command === undefined) return
    onClose()
    command.run()
  }

  function move(step: -1 | 1): void {
    if (results.length === 0) return
    const next = (activeIndex + step + results.length) % results.length
    setActiveId(results[next]?.id)
  }

  return (
    <Dialog label="Command palette" onClose={onClose} frameClassName={styles.frame}>
      <DialogHead>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Run a command"
          autoFocus
          controls={listId}
          activeDescendant={active === undefined ? undefined : `${listId}-${active.id}`}
          onEnter={() => {
            run(active)
          }}
          onMove={move}
        />
        <DialogClose label="Close command palette" onClick={onClose} />
      </DialogHead>

      <div
        id={listId}
        className={styles.results}
        role="listbox"
        aria-label="Matching commands"
        tabIndex={-1}
      >
        {results.map((command) => (
          <button
            key={command.id}
            type="button"
            className={styles.result}
            role="option"
            id={`${listId}-${command.id}`}
            aria-selected={command.id === active?.id}
            tabIndex={-1}
            ref={(element) => {
              if (element === null) options.current.delete(command.id)
              else options.current.set(command.id, element)
            }}
            onMouseEnter={() => {
              setActiveId(command.id)
            }}
            onClick={() => {
              run(command)
            }}
          >
            <span className={styles.label}>{command.label}</span>
            {command.shortcut !== undefined && (
              <span className={styles.keys}>
                {shortcutKeys(command.shortcut, window.luna.platform).map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            )}
          </button>
        ))}

        {results.length === 0 && <p className={styles.empty}>No matching commands</p>}
      </div>
    </Dialog>
  )
}
