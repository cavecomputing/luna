import { useEffect, useId, useRef, useState } from 'react'
import type { ProviderModel } from '../../../../shared/types.js'
import { cx } from '../../../lib/cx.js'
import { ChevronDown } from '../../../ui/icons/chevron-down.js'
import styles from './model-combobox.module.css'

type Props = {
  value: string
  models: ProviderModel[]
  disabled: boolean
  placeholder: string
  onChange: (value: string) => void
}

export function ModelCombobox({ value, models, disabled, placeholder, onChange }: Props): React.JSX.Element {
  const [isOpen, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const query = value.trim().toLocaleLowerCase()
  const options =
    showAll || query === '' ? models : models.filter((model) => model.id.toLocaleLowerCase().includes(query))
  const active = options[activeIndex] ?? options[0]

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

  function move(step: -1 | 1): void {
    if (options.length === 0) return
    if (!isOpen) {
      const selectedIndex = models.findIndex((model) => model.id === value)
      setShowAll(true)
      setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex)
      setOpen(true)
      return
    }
    setActiveIndex((current) => (current + step + options.length) % options.length)
  }

  function choose(model: ProviderModel): void {
    onChange(model.id)
    setOpen(false)
    setShowAll(false)
  }

  return (
    <div className={styles.root} ref={root}>
      <input
        role="combobox"
        aria-label="Model"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={isOpen && options.length > 0}
        aria-activedescendant={
          isOpen && active !== undefined ? `${listId}-${String(activeIndex)}` : undefined
        }
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={() => {
          setShowAll(false)
          if (options.length > 0) setOpen(true)
        }}
        onChange={(event) => {
          onChange(event.target.value)
          setShowAll(false)
          setActiveIndex(0)
          setOpen(models.length > 0)
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
              if (isOpen && active !== undefined) {
                event.preventDefault()
                choose(active)
              }
              break
            case 'Escape':
              setOpen(false)
              setShowAll(false)
              break
            case 'Tab':
              setOpen(false)
              setShowAll(false)
              break
          }
        }}
      />
      <button
        type="button"
        className={styles.chevron}
        aria-label={isOpen ? 'Close model suggestions' : 'Show model suggestions'}
        disabled={disabled || models.length === 0}
        onClick={() => {
          if (isOpen && showAll) {
            setOpen(false)
            setShowAll(false)
            return
          }
          const selectedIndex = models.findIndex((model) => model.id === value)
          setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex)
          setShowAll(true)
          setOpen(true)
        }}
      >
        <span className={cx(styles.chevronIcon, isOpen && styles.chevronOpen)}>
          <ChevronDown size={15} />
        </span>
      </button>

      {isOpen && options.length > 0 && (
        <div className={styles.menu} id={listId} role="listbox" aria-label="Model suggestions">
          {options.map((model, index) => (
            <button
              type="button"
              className={styles.option}
              id={`${listId}-${String(index)}`}
              key={model.id}
              role="option"
              aria-selected={model.id === value}
              data-active={index === activeIndex}
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onMouseEnter={() => {
                setActiveIndex(index)
              }}
              onClick={() => {
                choose(model)
              }}
            >
              <span>{model.id}</span>
              {model.ownedBy !== undefined && <small>{model.ownedBy}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
