import { svgBase, type IconProps } from './icon-props.js'

export function Pin({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} viewBox="0 0 20 20" width={size} height={size}>
      <path d="m14.5 3.5-2 2 .75 3.25 1.5 1.5-4.5 4.5-1.5-1.5-3.25-.75-2 2" />
      <path d="m8.75 13.25-4 4" />
    </svg>
  )
}
