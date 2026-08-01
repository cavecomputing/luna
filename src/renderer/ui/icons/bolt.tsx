import { svgBase, type IconProps } from './icon-props.js'

/** Fast mode. */
export function Bolt({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} fill="currentColor" strokeWidth={1.1}>
      <path d="M8.9 1.6 3.9 8.5h2.9l-1 5.9 5-6.9H7.9z" />
    </svg>
  )
}
