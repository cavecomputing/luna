import { svgBase, type IconProps } from './icon-props.js'

export function Send({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.8}>
      <path d="M3 8h9.5M8.5 4 12.5 8l-4 4" />
    </svg>
  )
}
