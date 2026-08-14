import { svgBase, type IconProps } from './icon-props.js'

export function Info({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 7.1v4M8 4.7h.01" />
    </svg>
  )
}
