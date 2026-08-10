import { svgBase, type IconProps } from './icon-props.js'

export function Pin({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} viewBox="0 0 24 24" width={size} height={size} strokeWidth={2}>
      <path d="M12 17v5" />
      <path d="M5 17h14" />
      <path d="M17 17v-6a4 4 0 0 0-4-4V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2a4 4 0 0 0-4 4v6" />
    </svg>
  )
}
