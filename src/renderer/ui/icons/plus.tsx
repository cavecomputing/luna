import { svgBase, type IconProps } from './icon-props.js'

export function Plus({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.8}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  )
}
