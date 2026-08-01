import { svgBase, type IconProps } from './icon-props.js'

export function Paperclip({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgBase} width={size} height={size}>
      <path d="M12.4 7.6 8 12a2.55 2.55 0 0 1-3.6-3.6l4.7-4.7a1.7 1.7 0 0 1 2.4 2.4l-4.7 4.7a.85.85 0 0 1-1.2-1.2l4.35-4.35" />
    </svg>
  )
}
