import type { Theme } from '../../../../shared/prefs.js'
import { Segmented, type Segment } from '../../../ui/segmented.js'
import { Bolt } from '../../../ui/icons/bolt.js'
import { Crescent } from '../../../ui/icons/crescent.js'
import { Gear } from '../../../ui/icons/gear.js'
import { Panel, Row } from '../panel.js'
import type { usePrefs } from '../../../lib/use-prefs.js'

const themes: Segment<Theme>[] = [
  { value: 'light', label: 'Light', icon: <Bolt size={14} /> },
  { value: 'dark', label: 'Dark', icon: <Crescent size={14} /> },
  { value: 'system', label: 'System', icon: <Gear size={14} /> },
]

type Props = {
  prefs: ReturnType<typeof usePrefs>
}

export function Appearance({ prefs }: Props): React.JSX.Element {
  return (
    <Panel title="Appearance" description="How Luna looks. Applies to every window.">
      <Row label="Theme" hint="Luna opens light unless you change this.">
        <Segmented
          label="Theme"
          value={prefs.prefs.theme}
          segments={themes}
          onChange={(theme) => {
            prefs.set('theme', theme)
          }}
        />
      </Row>
    </Panel>
  )
}
