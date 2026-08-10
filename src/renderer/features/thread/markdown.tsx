import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './code-block.js'
import { HtmlPreview } from './html-preview.js'
import styles from './markdown.module.css'

type Props = {
  text: string
}

type CodeProps = ComponentPropsWithoutRef<'code'> & ExtraProps
type PreProps = ComponentPropsWithoutRef<'pre'> & ExtraProps

function htmlLanguage(className: string | undefined): boolean {
  return className?.split(/\s+/).some((name) => name === 'language-html' || name === 'language-htm') ?? false
}

function codeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint'
        ? String(child)
        : '',
    )
    .join('')
}

function MarkdownCode({ className, children }: CodeProps): React.JSX.Element {
  if (htmlLanguage(className)) {
    return <HtmlPreview code={codeText(children).replace(/\n$/, '')} />
  }
  return <code className={className}>{children}</code>
}

function MarkdownPre({ children }: PreProps): React.JSX.Element {
  if (isValidElement<CodeProps>(children) && htmlLanguage(children.props.className)) {
    return children
  }
  if (isValidElement<CodeProps>(children)) {
    return (
      <CodeBlock
        className={children.props.className}
        code={codeText(children.props.children).replace(/\n$/, '')}
      />
    )
  }
  return <pre>{children}</pre>
}

function safeUrl(value: string, key: string): string {
  if (key === 'href') {
    if (value.startsWith('#')) return value
    try {
      return new URL(value).protocol === 'https:' ? value : ''
    } catch {
      return ''
    }
  }
  if (key === 'src' && /^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(value)) return value
  return ''
}

const components: Components = {
  a({ href, children, title }) {
    if (href === undefined || href === '') return <span>{children}</span>
    if (href.startsWith('#')) return <a href={href}>{children}</a>
    return (
      <a href={href} title={title} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
  code: MarkdownCode,
  img({ src, alt, title }) {
    return src === undefined || src === '' ? (
      <span className={styles.imageFallback}>{alt ?? 'Image'}</span>
    ) : (
      <img src={src} alt={alt ?? ''} title={title} loading="lazy" />
    )
  },
  pre: MarkdownPre,
}

export function Markdown({ text }: Props): React.JSX.Element {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        skipHtml
        urlTransform={safeUrl}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
