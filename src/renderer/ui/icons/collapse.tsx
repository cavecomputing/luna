import { svgBase, type IconProps } from './icon-props.js'

/** Double chevron. Points left when the sidebar is open, right when collapsed. */
export function Collapse({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size}>
      <path d="M8.5 4.5 5 8l3.5 3.5M12.5 4.5 9 8l3.5 3.5" />
    </svg>
  )
}
