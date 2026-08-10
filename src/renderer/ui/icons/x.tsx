import { svgBase, type IconProps } from './icon-props.js'

export function X({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size}>
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  )
}
