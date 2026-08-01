import type { ChatIcon } from '../../shared/types.js'

/**
 * The per-conversation glyph set. One path per ChatIcon, drawn in currentColor
 * so the tinted square around it decides the colour.
 *
 * This is the swap point for custom artwork: replace the <path> lookup with an
 * <img> against assets/, and nothing else in the app has to change.
 */
const paths: Record<ChatIcon, string> = {
  wave: 'M1.8 9c1.2-1.2 2.5-1.2 3.7 0s2.5 1.2 3.7 0 2.5-1.2 3.7 0M1.8 12.4c1.2-1.2 2.5-1.2 3.7 0s2.5 1.2 3.7 0 2.5-1.2 3.7 0',
  bowl: 'M2.4 7.6h11.2a5.6 5.6 0 0 1-11.2 0ZM1.8 13.4h12.4',
  book: 'M8 4.4C6.9 3.5 5.4 3.1 3.4 3.1v8.6c2 0 3.5.4 4.6 1.2 1.1-.8 2.6-1.2 4.6-1.2V3.1c-2 0-3.5.4-4.6 1.3ZM8 4.4v8.5',
  dumbbell: 'M2.6 6.3v3.4M4.9 4.9v6.2M11.1 4.9v6.2M13.4 6.3v3.4M4.9 8h6.2',
  leaf: 'M12.9 3.2C12.9 8.6 9.6 12.2 4.6 12.8c-1-4.9 2.2-9 8.3-9.6ZM4.6 12.8c1.6-3.2 3.7-5.3 6.4-6.8',
  gift: 'M2.5 7.3h11v6.2h-11zM2.5 7.3V5.6h11v1.7M8 5.6v7.9M8 5.6C6.9 4 4.3 3.5 4.3 5.1S7 5.6 8 5.6s3.7.5 3.7-1S9.1 4 8 5.6',
  camera: 'M2.4 5.6h2.3l1-1.6h4.6l1 1.6h2.3v7.6H2.4zM10.3 9.3a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0',
  spark: 'M8 2.2 9.4 6.6 13.8 8 9.4 9.4 8 13.8 6.6 9.4 2.2 8 6.6 6.6Z',
}

type Props = {
  icon: ChatIcon
  size?: number
}

export function ChatGlyph({ icon, size = 16 }: Props): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[icon]} />
    </svg>
  )
}
