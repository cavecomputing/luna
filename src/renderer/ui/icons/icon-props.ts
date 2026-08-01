/** Shared shape for every icon in this folder. */
export type IconProps = {
  size?: number
}

/** Defaults every icon applies to its root <svg>. */
export const svgBase = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const
