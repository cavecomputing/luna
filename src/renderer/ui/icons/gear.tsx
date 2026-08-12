import { svgBase, type IconProps } from './icon-props.js'

/** Settings. An eight-tooth cog around a center hub. */
export function Gear({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <circle cx="8" cy="8" r="2.05" />
      <path d="M14.22 7.01A6.3 6.3 0 0 1 14.22 8.99L12.54 8.72A4.6 4.6 0 0 1 11.72 10.7L13.1 11.7A6.3 6.3 0 0 1 11.7 13.1L10.7 11.72A4.6 4.6 0 0 1 8.72 12.54L8.99 14.22A6.3 6.3 0 0 1 7.01 14.22L7.28 12.54A4.6 4.6 0 0 1 5.3 11.72L4.3 13.1A6.3 6.3 0 0 1 2.9 11.7L4.28 10.7A4.6 4.6 0 0 1 3.46 8.72L1.78 8.99A6.3 6.3 0 0 1 1.78 7.01L3.46 7.28A4.6 4.6 0 0 1 4.28 5.3L2.9 4.3A6.3 6.3 0 0 1 4.3 2.9L5.3 4.28A4.6 4.6 0 0 1 7.28 3.46L7.01 1.78A6.3 6.3 0 0 1 8.99 1.78L8.72 3.46A4.6 4.6 0 0 1 10.7 4.28L11.7 2.9A6.3 6.3 0 0 1 13.1 4.3L11.72 5.3A4.6 4.6 0 0 1 12.54 7.28Z" />
    </svg>
  )
}
