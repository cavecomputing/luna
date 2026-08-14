import { svgBase, type IconProps } from './icon-props.js'

export function Server({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <rect x="2" y="2.5" width="12" height="4" rx="1" />
      <rect x="2" y="9.5" width="12" height="4" rx="1" />
      <path d="M4.5 4.5h.01M4.5 11.5h.01M7 4.5h5M7 11.5h5" />
    </svg>
  )
}
