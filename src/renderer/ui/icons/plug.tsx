import { svgBase, type IconProps } from './icon-props.js'

/** Connected MCP servers. */
export function Plug({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={1.3}>
      <path d="M6 1.75v3.5M10 1.75v3.5" />
      <path d="M3.75 5.25h8.5v2.5a4.25 4.25 0 0 1-8.5 0z" />
      <path d="M8 12v2.25" />
    </svg>
  )
}
