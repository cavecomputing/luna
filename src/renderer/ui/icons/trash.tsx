import { svgBase, type IconProps } from './icon-props.js'

export function Trash({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} viewBox="0 0 20 20" width={size} height={size}>
      <path d="M4 6h12" />
      <path d="M8 3h4l1 3H7l1-3Z" />
      <path d="m6 6 .75 11h6.5L14 6" />
      <path d="M9 9v5M11 9v5" />
    </svg>
  )
}
