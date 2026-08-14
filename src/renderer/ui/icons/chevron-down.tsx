import { svgBase, type IconProps } from './icon-props.js'

export function ChevronDown({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size}>
      <path d="m3.75 6.25 4.25 4.25 4.25-4.25" />
    </svg>
  )
}
