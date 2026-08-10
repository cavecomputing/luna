import { useEffect, useRef, useState } from 'react'
import styles from './copy-button.module.css'

type Props = {
  code: string
}

type Status = 'idle' | 'copied' | 'failed'

const labels: Record<Status, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Retry',
}

export function CopyButton({ code }: Props): React.JSX.Element {
  const [status, setStatus] = useState<Status>('idle')
  const reset = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      window.clearTimeout(reset.current)
    },
    [],
  )

  async function copy(): Promise<void> {
    window.clearTimeout(reset.current)

    try {
      if (navigator.clipboard === undefined) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(code)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }

    reset.current = window.setTimeout(() => {
      setStatus('idle')
    }, 2_000)
  }

  const ariaLabel =
    status === 'copied' ? 'Code copied' : status === 'failed' ? 'Copy failed, retry' : 'Copy code'

  return (
    <button
      type="button"
      className={styles.copy}
      data-status={status}
      aria-label={ariaLabel}
      onClick={() => void copy()}
    >
      <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
        {status === 'copied' ? (
          <path d="m3 8.5 3 3 7-7" />
        ) : (
          <>
            <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
            <path d="M10.75 3.25v-.5h-8v8h.5" />
          </>
        )}
      </svg>
      <span>{labels[status]}</span>
    </button>
  )
}
