import { useCallback, useEffect, useRef, useState } from 'react'
import type { HtmlPreviewRef } from '../../../shared/ipc.js'
import { CopyButton } from './copy-button.js'
import styles from './html-preview.module.css'

type Props = {
  code: string
  canRender?: boolean
}

type View =
  | { mode: 'source' }
  | { mode: 'loading' }
  | { mode: 'rendered'; preview: HtmlPreviewRef }
  | { mode: 'error' }

export function HtmlPreview({ code, canRender = true }: Props): React.JSX.Element {
  const [view, setView] = useState<View>({ mode: 'source' })
  const active = useRef<HtmlPreviewRef | undefined>(undefined)
  const generation = useRef(0)

  const release = useCallback((preview: HtmlPreviewRef | undefined): void => {
    if (preview !== undefined) void window.luna.preview.release(preview.id)
  }, [])

  const showSource = useCallback((): void => {
    generation.current += 1
    const preview = active.current
    active.current = undefined
    release(preview)
    setView({ mode: 'source' })
  }, [release])

  useEffect(
    () => () => {
      generation.current += 1
      release(active.current)
      active.current = undefined
    },
    [release],
  )

  const renderPreview = useCallback(async (): Promise<void> => {
    if (!canRender || view.mode === 'loading' || view.mode === 'rendered') return
    const request = generation.current + 1
    generation.current = request
    setView({ mode: 'loading' })
    const result = await window.luna.preview.create(code)
    if (generation.current !== request) {
      if (result.ok) release(result.value)
      return
    }
    if (!result.ok) {
      setView({ mode: 'error' })
      return
    }
    active.current = result.value
    setView({ mode: 'rendered', preview: result.value })
  }, [canRender, code, release, view.mode])

  const rendered = view.mode === 'loading' || view.mode === 'rendered'
  return (
    <section className={styles.preview} aria-label="HTML code block">
      <header className={styles.bar}>
        <span className={styles.label}>HTML</span>
        <div className={styles.actions}>
          <div className={styles.modes} aria-label="HTML display mode">
            <button
              type="button"
              className={!rendered ? styles.on : undefined}
              aria-pressed={!rendered}
              onClick={showSource}
            >
              Source
            </button>
            <button
              type="button"
              className={rendered ? styles.on : undefined}
              aria-pressed={rendered}
              disabled={!canRender || view.mode === 'loading'}
              title={!canRender ? 'Available when the response finishes' : undefined}
              onClick={() => void renderPreview()}
            >
              Render
            </button>
          </div>
          <CopyButton code={code} />
        </div>
      </header>

      {view.mode === 'rendered' ? (
        <iframe
          className={styles.frame}
          title="Rendered HTML preview"
          sandbox="allow-popups"
          referrerPolicy="no-referrer"
          src={view.preview.url}
        />
      ) : (
        <>
          {view.mode === 'loading' && (
            <p className={styles.status} role="status">
              Preparing preview…
            </p>
          )}
          {view.mode === 'error' && (
            <p className={styles.status} role="alert">
              Preview unavailable. Try again.
            </p>
          )}
          <pre className={styles.source}>
            <code>{code}</code>
          </pre>
        </>
      )}
    </section>
  )
}
