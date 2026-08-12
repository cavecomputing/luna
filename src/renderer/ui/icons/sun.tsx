import { svgBase, type IconProps } from './icon-props.js'

/** Light themes. A circle with eight rays. */
export function Sun({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <circle cx="8" cy="8" r="2.15" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.15 1.15M11.45 11.45l1.15 1.15M12.6 3.4l-1.15 1.15M4.55 11.45 3.4 12.6" />
    </svg>
  )
}
