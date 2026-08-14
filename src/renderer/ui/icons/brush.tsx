import { svgBase, type IconProps } from './icon-props.js'

export function Brush({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <path d="m13.7 2.3-6.8 6.8-2-2 6.8-6.8a1.4 1.4 0 0 1 2 2Z" />
      <path d="M7.1 9.2c.2 2.7-1.1 4.5-3.6 4.5-1.2 0-2-.7-2.3-1.4 1.6.1 1.7-.9 1.9-2.2.2-1.4 1.5-2.4 2.9-2.1" />
    </svg>
  )
}
