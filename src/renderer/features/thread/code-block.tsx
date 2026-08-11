import { useMemo, type ReactNode } from 'react'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { common, createLowlight } from 'lowlight'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { CopyButton } from './copy-button.js'
import styles from './code-block.module.css'
import { cx } from '../../lib/cx.js'

const lowlight = createLowlight(common)

type Props = {
  className?: string | undefined
  code: string
}

function languageOf(className: string | undefined): string | undefined {
  const language = className
    ?.split(/\s+/)
    .find((name) => name.startsWith('language-'))
    ?.slice('language-'.length)

  return language === undefined || language === '' ? undefined : language
}

/**
 * Highlight as a HAST tree rendered to React elements — never as an HTML
 * string — so model output keeps its no-innerHTML guarantee. Undefined for
 * languages lowlight doesn't know; the block then renders as plain text.
 */
function highlight(language: string | undefined, code: string): ReactNode {
  if (language === undefined || !lowlight.registered(language)) return undefined
  // toJsxRuntime's declared return resolves to any under React 19 typings,
  // but the value is always a valid React node tree.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return toJsxRuntime(lowlight.highlight(language, code), { Fragment, jsx, jsxs })
}

export function CodeBlock({ className, code }: Props): React.JSX.Element {
  const language = languageOf(className)
  const label = language === undefined ? 'Code' : language.toUpperCase()
  const aria = language === undefined ? 'Code block' : `${label} code block`
  const highlighted = useMemo(() => highlight(language, code), [language, code])

  return (
    <section className={styles.block} aria-label={aria}>
      <header className={styles.bar}>
        <span className={styles.label}>{label}</span>
        <CopyButton code={code} />
      </header>
      <pre className={styles.source}>
        <code className={cx(className, highlighted !== undefined && 'hljs')}>
          {highlighted ?? code}
        </code>
      </pre>
    </section>
  )
}
