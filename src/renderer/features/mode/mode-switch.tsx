import type { ModelSlots, Mode } from '../../../shared/types.js'
import { Segmented, type Segment } from '../../ui/segmented.js'
import { Bolt } from '../../ui/icons/bolt.js'
import { Star } from '../../ui/icons/star.js'

type Props = {
  value: Mode
  models: ModelSlots
  onChange: (mode: Mode) => void
}

function modelTip(label: string, model: string): string {
  return model === '' ? `${label} model is not configured` : `${label} model: ${model}`
}

/** Per-conversation model choice. */
export function ModeSwitch({ value, models, onChange }: Props): React.JSX.Element {
  const segments: Segment<Mode>[] = [
    {
      value: 'fast',
      label: 'Fast',
      icon: <Bolt size={14} />,
      tooltip: modelTip('Fast', models.fast.model),
    },
    {
      value: 'expert',
      label: 'Expert',
      icon: <Star size={14} />,
      tooltip: modelTip('Expert', models.expert.model),
    },
  ]
  return (
    <Segmented
      label="Response mode"
      value={value}
      segments={segments}
      onChange={onChange}
      size="compact"
    />
  )
}
