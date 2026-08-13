import { useState } from 'react'
import { Panel, Row } from '../panel.js'
import styles from './privacy.module.css'

/** The word that has to be typed before the delete button becomes usable. */
const CONFIRM = 'DELETE'

function message(code: string): string {
  switch (code) {
    case 'privacy/export':
      return 'The export could not be completed. Try another folder.'
    case 'privacy/busy':
      return 'A delete is already in progress.'
    case 'secret/unavailable':
      return 'Your saved API keys could not be removed, so nothing else was deleted.'
    case 'privacy/failed':
      return 'Some data could not be removed. Your saved API keys were deleted; conversations may remain.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

export function Privacy(): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [deleteStatus, setDeleteStatus] = useState('')

  async function exportAll(): Promise<void> {
    setBusy(true)
    setExportStatus('Exporting…')
    const result = await window.luna.privacy.exportAll()
    setBusy(false)
    if (!result.ok) {
      setExportStatus(message(result.code))
      return
    }
    const { written } = result.value
    setExportStatus(
      written === 0
        ? ''
        : `Exported ${String(written)} conversation${written === 1 ? '' : 's'}.`,
    )
  }

  async function deleteAll(): Promise<void> {
    setBusy(true)
    setDeleteStatus('')
    const result = await window.luna.privacy.deleteAll()
    setBusy(false)
    setTyped('')
    if (!result.ok) {
      setDeleteStatus(message(result.code))
      return
    }
    setDeleteStatus(result.value.deleted ? 'Luna is back to a clean install.' : '')
  }

  return (
    <Panel title="Privacy" description="Where your conversations live and how to remove them.">
      <p className={styles.note}>
        Luna talks only to the endpoints you configure. Nothing is sent anywhere else, and
        there is no telemetry.
      </p>

      <Row
        label="Export conversations"
        hint="Writes one readable JSON file per conversation, with attachments included. API keys are never exported."
        block
      >
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => {
            void exportAll()
          }}
        >
          Export all conversations…
        </button>
        {exportStatus !== '' && <p className={styles.status}>{exportStatus}</p>}
      </Row>

      <Row
        label="Delete all data"
        hint={`Removes every conversation, attachment, preference, provider, and saved API key, along with Luna's local backups. Type ${CONFIRM} to enable.`}
        block
      >
        <div className={styles.confirm}>
          <input
            aria-label={`Type ${CONFIRM} to confirm`}
            value={typed}
            placeholder={CONFIRM}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => {
              setTyped(event.target.value)
            }}
          />
          <button
            type="button"
            className={styles.danger}
            disabled={busy || typed !== CONFIRM}
            onClick={() => {
              void deleteAll()
            }}
          >
            Delete All Data…
          </button>
        </div>
        <p className={styles.warning} role="alert">
          This cannot be undone. Export first if you want a copy.
        </p>
        {deleteStatus !== '' && <p className={styles.status}>{deleteStatus}</p>}
      </Row>
    </Panel>
  )
}
