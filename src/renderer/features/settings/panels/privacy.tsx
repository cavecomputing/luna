import { useEffect, useState } from 'react'
import type { AttachmentStorage } from '../../../../shared/ipc.js'
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
    case 'attachment/busy':
      return 'Attachment cleanup is already in progress.'
    case 'attachment/io':
      return 'Attachment storage could not be updated. Please try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

export function Privacy(): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [deleteStatus, setDeleteStatus] = useState('')
  const [storage, setStorage] = useState<AttachmentStorage>()
  const [storageError, setStorageError] = useState('')
  const [cleanupStatus, setCleanupStatus] = useState('')

  async function loadStorage(): Promise<void> {
    const result = await window.luna.attachments.storage()
    if (result.ok) {
      setStorage(result.value)
      setStorageError('')
    } else {
      setStorageError(message(result.code))
    }
  }

  useEffect(() => {
    let live = true
    const refresh = (): void => {
      void window.luna.attachments.storage().then((result) => {
        if (!live) return
        if (result.ok) {
          setStorage(result.value)
          setStorageError('')
        } else {
          setStorageError(message(result.code))
        }
      })
    }
    refresh()
    const unsubscribe = window.luna.onAttachmentStorage(refresh)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

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

  async function clearUnsent(): Promise<void> {
    setBusy(true)
    setCleanupStatus('')
    const result = await window.luna.attachments.clearUnsent()
    setBusy(false)
    if (!result.ok) {
      setCleanupStatus(message(result.code))
      return
    }
    const { removedBytes, removedCount } = result.value
    setCleanupStatus(
      removedCount === 0
        ? ''
        : `Removed ${String(removedCount)} unsent attachment${removedCount === 1 ? '' : 's'} (${size(removedBytes)}).`,
    )
    await loadStorage()
  }

  return (
    <Panel title="Privacy" description="Where your conversations live and how to remove them.">
      <p className={styles.note}>
        Luna talks only to the endpoints you configure. Nothing is sent anywhere else, and
        there is no telemetry.
      </p>

      <Row
        label="Attachment storage"
        hint="Counts attachment content in the active conversation database. Local backup copies are not included."
        block
      >
        {storage !== undefined && (
          <div className={styles.usage}>
            <span>
              <strong>{size(storage.totalBytes)}</strong> across {String(storage.totalCount)}{' '}
              attachment{storage.totalCount === 1 ? '' : 's'}
            </span>
            <span>
              {size(storage.sentBytes)} sent · {size(storage.unsentBytes)} unsent
            </span>
          </div>
        )}
        <button
          type="button"
          className={styles.secondary}
          disabled={busy || storage === undefined || storage.unsentCount === 0}
          onClick={() => {
            void clearUnsent()
          }}
        >
          Remove unsent attachments…
        </button>
        <p className={styles.scope}>
          Removes files currently staged in composers. Attachments already sent in messages are kept.
        </p>
        {storageError !== '' && <p className={styles.status}>{storageError}</p>}
        {cleanupStatus !== '' && <p className={styles.status}>{cleanupStatus}</p>}
      </Row>

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
