import { svgBase, type IconProps } from './icon-props.js'

/** Expert mode. Echoes the Luna mark. */
export function Crescent({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size}>
      <path d="M13.1 9.9A5.6 5.6 0 0 1 6.1 2.9a5.6 5.6 0 1 0 7 7Z" />
    </svg>
  )
}
