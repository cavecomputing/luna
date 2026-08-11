import { useState } from 'react'
import mascot from '../../../../assets/crash-mascot.png'
import styles from './crash-app.module.css'

export function CrashApp(): React.JSX.Element {
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)

  async function recover(): Promise<void> {
    setWorking(true)
    setFailed(false)
    try {
      const result = await window.luna.app.recover()
      if (result.ok) return
    } catch {
      // If navigation already replaced this page, React never paints the fallback.
    }
    setWorking(false)
    setFailed(true)
  }

  async function close(): Promise<void> {
    setWorking(true)
    try {
      const result = await window.luna.app.closeWindow()
      if (result.ok) return
    } catch {
      // A successful close can destroy the page before the invocation settles.
    }
    setWorking(false)
    setFailed(true)
  }

  return (
    <main className={styles.screen}>
      <section className={styles.content} aria-labelledby="crash-title">
        <img className={styles.mascot} src={mascot} alt="" />
        <h1 id="crash-title" className={styles.title}>Luna took a tumble.</h1>
        <p className={styles.message}>
          This window stopped unexpectedly. Your saved chats are still on this device, though a
          reply that was arriving may need to be tried again.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            autoFocus
            disabled={working}
            onClick={() => void recover()}
          >
            {working ? 'Reopening…' : 'Try again'}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={working}
            onClick={() => void close()}
          >
            Close window
          </button>
        </div>
        {failed && (
          <p className={styles.error} role="alert">
            Luna couldn&rsquo;t recover this window. Close it and open Luna again.
          </p>
        )}
      </section>
    </main>
  )
}
