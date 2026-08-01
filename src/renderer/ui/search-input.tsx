import { Search } from './icons/search.js'
import styles from './search-input.module.css'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
}: Props): React.JSX.Element {
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
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
    </div>
  )
}
