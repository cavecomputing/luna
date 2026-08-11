import type { KeyboardEvent } from 'react'
import { Search } from './icons/search.js'
import styles from './search-input.module.css'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  onEnter?: () => void
  onMove?: (step: -1 | 1) => void
  controls?: string
  activeDescendant?: string | undefined
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  autoFocus = false,
  onEnter,
  onMove,
  controls,
  activeDescendant,
}: Props): React.JSX.Element {
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      onEnter?.()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      onMove?.(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.icon}>
        <Search size={14} />
      </span>
      <input
        type="search"
        className={styles.input}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        role={controls === undefined ? undefined : 'combobox'}
        aria-autocomplete={controls === undefined ? undefined : 'list'}
        aria-expanded={controls === undefined ? undefined : true}
        aria-controls={controls}
        aria-activedescendant={activeDescendant}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
