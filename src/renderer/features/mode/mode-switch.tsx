import type { Mode } from '../../../shared/types.js'
import { Segmented, type Segment } from '../../ui/segmented.js'
import { Bolt } from '../../ui/icons/bolt.js'
import { Star } from '../../ui/icons/star.js'

const segments: Segment<Mode>[] = [
  { value: 'fast', label: 'Fast', icon: <Bolt size={14} /> },
  { value: 'expert', label: 'Expert', icon: <Star size={14} /> },
]

type Props = {
  value: Mode
  onChange: (mode: Mode) => void
}

/** Per-conversation model choice. */
export function ModeSwitch({ value, onChange }: Props): React.JSX.Element {
  return (
    <Segmented label="Response mode" value={value} segments={segments} onChange={onChange} />
  )
}
