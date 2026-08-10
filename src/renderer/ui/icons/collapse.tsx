import { svgBase, type IconProps } from './icon-props.js'

/** Split-panel glyph. The shaded rail represents the conversation sidebar. */
export function Collapse({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size}>
      <path
        d="M4.75 2.5h1.5v11h-1.5A2.5 2.5 0 0 1 2.25 11V5a2.5 2.5 0 0 1 2.5-2.5Z"
        fill="currentColor"
        opacity="0.18"
        stroke="none"
      />
      <rect x="2.25" y="2.5" width="11.5" height="11" rx="2.5" />
      <path d="M6.25 2.75v10.5" />
    </svg>
  )
}
