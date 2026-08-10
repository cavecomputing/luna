import { svgBase, type IconProps } from './icon-props.js'

export function Stop({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.8}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
    </svg>
  )
}
