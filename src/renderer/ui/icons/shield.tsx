import { svgBase, type IconProps } from './icon-props.js'

export function Shield({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <path d="M8 1.4 13 3.3v3.8c0 3.3-2 5.9-5 7.5-3-1.6-5-4.2-5-7.5V3.3z" />
    </svg>
  )
}
