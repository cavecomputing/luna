import { CopyButton } from './copy-button.js'
import styles from './code-block.module.css'

type Props = {
  className?: string | undefined
  code: string
}

function languageName(className: string | undefined): string {
  const language = className
    ?.split(/\s+/)
    .find((name) => name.startsWith('language-'))
    ?.slice('language-'.length)

  return language === undefined || language === '' ? 'Code' : language.toUpperCase()
}

export function CodeBlock({ className, code }: Props): React.JSX.Element {
  const language = languageName(className)
  const label = language === 'Code' ? 'Code block' : `${language} code block`

  return (
    <section className={styles.block} aria-label={label}>
      <header className={styles.bar}>
        <span className={styles.label}>{language}</span>
        <CopyButton code={code} />
      </header>
      <pre className={styles.source}>
        <code className={className}>{code}</code>
      </pre>
    </section>
  )
}
