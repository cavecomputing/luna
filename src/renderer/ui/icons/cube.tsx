import { svgBase, type IconProps } from './icon-props.js'

export function Cube({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <path d="m8 1.5 5.5 3.1v6.8L8 14.5l-5.5-3.1V4.6z" />
      <path d="m2.8 4.8 5.2 3 5.2-3M8 7.8v6.4" />
    </svg>
  )
}
