import { svgBase, type IconProps } from './icon-props.js'

export function ChatBubble({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <path d="M13.8 7.5a5.8 5.8 0 0 1-6 5.6 7.5 7.5 0 0 1-2.1-.3L2.5 14l.9-2.8a5.3 5.3 0 0 1-1.2-3.4 5.8 5.8 0 0 1 6-5.6 5.8 5.8 0 0 1 5.6 5.3Z" />
    </svg>
  )
}
