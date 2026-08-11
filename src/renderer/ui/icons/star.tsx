import { svgBase, type IconProps } from './icon-props.js'

/** Expert mode. */
export function Star({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} viewBox="0 0 24 24" width={size} height={size}>
      <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" />
    </svg>
  )
}
