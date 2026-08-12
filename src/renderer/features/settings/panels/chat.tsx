import type { Mode } from '../../../../shared/types.js'
import { Segmented, type Segment } from '../../../ui/segmented.js'
import { Toggle } from '../../../ui/toggle.js'
import { Bolt } from '../../../ui/icons/bolt.js'
import { Star } from '../../../ui/icons/star.js'
import { Panel, Row } from '../panel.js'
import type { usePrefs } from '../../../lib/use-prefs.js'

const modes: Segment<Mode>[] = [
  { value: 'fast', label: 'Fast', icon: <Bolt size={14} /> },
  { value: 'expert', label: 'Expert', icon: <Star size={14} /> },
]

type Props = {
  prefs: ReturnType<typeof usePrefs>
}

export function Chat({ prefs }: Props): React.JSX.Element {
  const { prefs: p, set } = prefs

  return (
    <Panel title="Chat" description="Defaults for new conversations.">
      <Row label="Default mode" hint="Which model new chats start on.">
        <Segmented
          label="Default mode"
          value={p.defaultMode}
          segments={modes}
          onChange={(mode) => {
            set('defaultMode', mode)
          }}
        />
      </Row>

      <Row label="Stream replies" hint="Show text as it arrives instead of all at once.">
        <Toggle
          label="Stream replies"
          checked={p.stream}
          onChange={(v) => {
            set('stream', v)
          }}
        />
      </Row>

      <Row label="Name chats automatically" hint="Uses the Fast model after the first reply.">
        <Toggle
          label="Name chats automatically"
          checked={p.autoTitle}
          onChange={(v) => {
            set('autoTitle', v)
          }}
        />
      </Row>
    </Panel>
  )
}
