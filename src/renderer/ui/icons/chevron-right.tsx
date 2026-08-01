import { svgBase, type IconProps } from './icon-props.js'

export function ChevronRight({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size}>
      <path d="m6.25 3.75 4.25 4.25-4.25 4.25" />
    </svg>
  )
}
