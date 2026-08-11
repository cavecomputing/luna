import { useEffect, useState } from 'react'
import type { DatabaseRecoveryStatus } from '../../../shared/ipc.js'
import styles from './database-recovery-app.module.css'

type Action = 'restore' | 'retry' | 'fresh' | 'quit'

function copy(status: DatabaseRecoveryStatus): { title: string; message: string } {
  if (status.kind === 'corrupt') {
    const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(status.backupCreatedAt)
    return {
      title: 'Luna found damaged local data.',
      message: `A valid backup from ${date} is ready to restore. The damaged data will be preserved.`,
    }
  }
  if (status.kind === 'corrupt-empty') {
    return {
      title: 'Luna couldn’t recover its local data.',
      message: 'No valid backup was found. You can quit, or preserve the damaged data and start fresh.',
    }
  }
  if (status.kind === 'newer-version') {
    return {
      title: 'This data needs a newer version of Luna.',
      message: 'Nothing was changed. Quit Luna and reopen this data with the newer app version that created it.',
    }
  }
  return {
    title: 'Luna couldn’t update its local data.',
    message: 'Your data and a pre-update backup were left intact. You can try again or quit Luna.',
  }
}

export function DatabaseRecoveryApp(): React.JSX.Element {
  const [status, setStatus] = useState<DatabaseRecoveryStatus>()
  const [working, setWorking] = useState<Action>()
  const [confirmFresh, setConfirmFresh] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void window.luna.recovery.status().then((result) => {
      if (active && result.ok) setStatus(result.value)
      else if (active) setFailed(true)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => {
      active = false
    }
  }, [])

  async function run(action: Action): Promise<void> {
    setWorking(action)
    setFailed(false)
    try {
      const result = action === 'restore'
        ? await window.luna.recovery.restore()
        : action === 'retry'
          ? await window.luna.recovery.retry()
          : action === 'fresh'
            ? await window.luna.recovery.startFresh()
            : await window.luna.recovery.quit()
      if (result.ok) return
    } catch {
      // A successful action may destroy this page before the invocation settles.
    }
    setWorking(undefined)
    setFailed(true)
  }

  if (status === undefined) {
    return (
      <main className={styles.screen}>
        <section className={styles.content} aria-live="polite">
          <h1 className={styles.title}>Checking Luna’s local data…</h1>
          {failed && <p className={styles.error} role="alert">Luna couldn’t open recovery.</p>}
        </section>
      </main>
    )
  }

  const text = copy(status)
  const disabled = working !== undefined
  return (
    <main className={styles.screen}>
      <section className={styles.content} aria-labelledby="recovery-title">
        <h1 id="recovery-title" className={styles.title}>{text.title}</h1>
        <p className={styles.message}>{text.message}</p>

        {confirmFresh ? (
          <div className={styles.confirm} role="group" aria-label="Confirm starting fresh">
            <p>This creates an empty Luna database. The damaged files will remain preserved.</p>
            <div className={styles.actions}>
              <button className={styles.secondary} type="button" autoFocus disabled={disabled} onClick={() => {
                setConfirmFresh(false)
              }}>
                Go back
              </button>
              <button className={styles.danger} type="button" disabled={disabled} onClick={() => void run('fresh')}>
                {working === 'fresh' ? 'Starting…' : 'Create empty database'}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            {status.kind === 'corrupt' && (
              <button className={styles.primary} type="button" autoFocus disabled={disabled} onClick={() => void run('restore')}>
                {working === 'restore' ? 'Restoring…' : 'Restore backup'}
              </button>
            )}
            {status.kind === 'migration-failed' && (
              <button className={styles.primary} type="button" autoFocus disabled={disabled} onClick={() => void run('retry')}>
                {working === 'retry' ? 'Trying…' : 'Try again'}
              </button>
            )}
            {status.kind === 'corrupt-empty' && (
              <button className={styles.danger} type="button" disabled={disabled} onClick={() => {
                setConfirmFresh(true)
              }}>
                Start fresh
              </button>
            )}
            <button className={styles.secondary} type="button" autoFocus={status.kind === 'newer-version'} disabled={disabled} onClick={() => void run('quit')}>
              {working === 'quit' ? 'Quitting…' : 'Quit Luna'}
            </button>
          </div>
        )}
        {failed && <p className={styles.error} role="alert">Luna couldn’t complete that recovery action. Your existing data was not discarded.</p>}
      </section>
    </main>
  )
}
