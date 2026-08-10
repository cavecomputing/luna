import { useState } from 'react'
import { CopyButton } from './copy-button.js'
import styles from './html-preview.module.css'

type Props = {
  code: string
}

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

export function previewDocument(code: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
    <meta name="referrer" content="no-referrer">
    <base target="_blank">
    <style>
      :root { color-scheme: light dark; }
      html, body { min-height: 100%; }
      body { margin: 0; overflow-wrap: anywhere; }
      *, *::before, *::after { box-sizing: border-box; }
    </style>
  </head>
  <body>${code}</body>
</html>`
}

export function HtmlPreview({ code }: Props): React.JSX.Element {
  const [rendered, setRendered] = useState(false)

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
              onClick={() => {
                setRendered(false)
              }}
            >
              Source
            </button>
            <button
              type="button"
              className={rendered ? styles.on : undefined}
              aria-pressed={rendered}
              onClick={() => {
                setRendered(true)
              }}
            >
              Render
            </button>
          </div>
          <CopyButton code={code} />
        </div>
      </header>

      {rendered ? (
        <iframe
          className={styles.frame}
          title="Rendered HTML preview"
          sandbox="allow-popups"
          referrerPolicy="no-referrer"
          srcDoc={previewDocument(code)}
        />
      ) : (
        <pre className={styles.source}>
          <code>{code}</code>
        </pre>
      )}
    </section>
  )
}
