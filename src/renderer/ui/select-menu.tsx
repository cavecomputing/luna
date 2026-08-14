import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '../lib/cx.js'
import { ChevronDown } from './icons/chevron-down.js'
import styles from './select-menu.module.css'

export type SelectOption = {
  value: string
  label: string
}

type Props = {
  label: string
  value: string
  options: SelectOption[]
  placeholder: string
  onChange: (value: string) => void
}

export function SelectMenu({ label, value, options, placeholder, onChange }: Props): React.JSX.Element {
  const [isOpen, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex]
  const active = options[activeIndex]

  useEffect(() => {
    if (!isOpen) return
    function close(event: PointerEvent): void {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
    }
  }, [isOpen])

  function open(): void {
    setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex)
    setOpen(true)
  }

  function move(step: -1 | 1): void {
    if (options.length === 0) return
    if (!isOpen) {
      open()
      return
    }
    setActiveIndex((current) => (current + step + options.length) % options.length)
  }

  function choose(index: number): void {
    const option = options[index]
    if (option === undefined) return
    onChange(option.value)
    setOpen(false)
  }

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.trigger}
        role="combobox"
        aria-label={label}
        aria-controls={listId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={
          isOpen && active !== undefined ? `${listId}-${String(activeIndex)}` : undefined
        }
        onClick={() => {
          if (isOpen) setOpen(false)
          else open()
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case 'ArrowDown':
              event.preventDefault()
              move(1)
              break
            case 'ArrowUp':
              event.preventDefault()
              move(-1)
              break
            case 'Enter':
            case ' ':
              event.preventDefault()
              if (isOpen) choose(activeIndex)
              else open()
              break
            case 'Escape':
              setOpen(false)
              break
          }
        }}
      >
        <span className={cx(styles.value, selected === undefined && styles.placeholder)}>
          {selected?.label ?? placeholder}
        </span>
        <span className={cx(styles.chevron, isOpen && styles.chevronOpen)} aria-hidden="true">
          <ChevronDown size={15} />
        </span>
      </button>

      {isOpen && (
        <div className={styles.menu} id={listId} role="listbox" aria-label={`${label} options`}>
          {options.map((option, index) => (
            <button
              type="button"
              className={styles.option}
              id={`${listId}-${String(index)}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              tabIndex={-1}
              onMouseEnter={() => {
                setActiveIndex(index)
              }}
              onClick={() => {
                choose(index)
              }}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <svg className={styles.check} viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3.25 8.25 3 3 6.5-6.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
