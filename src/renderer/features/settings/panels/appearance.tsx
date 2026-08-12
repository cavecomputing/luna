import type { Theme } from '../../../../shared/prefs.js'
import { Segmented, type Segment } from '../../../ui/segmented.js'
import { Crescent } from '../../../ui/icons/crescent.js'
import { Sun } from '../../../ui/icons/sun.js'
import { Panel, Row } from '../panel.js'
import type { usePrefs } from '../../../lib/use-prefs.js'

const themes: Segment<Theme>[] = [
  { value: 'luna-light', label: 'Luna Light', icon: <Sun size={14} /> },
  { value: 'luna-dark', label: 'Luna Dark', icon: <Crescent size={14} /> },
  { value: 'gruvbox-light', label: 'Gruvbox Light', icon: <Sun size={14} /> },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark', icon: <Crescent size={14} /> },
]

type Props = {
  prefs: ReturnType<typeof usePrefs>
}

export function Appearance({ prefs }: Props): React.JSX.Element {
  return (
    <Panel title="Appearance" description="How Luna looks. Applies to every window.">
      <Row label="Theme" hint="Luna Light is the default." block>
        <Segmented
          label="Theme"
          value={prefs.prefs.theme}
          segments={themes}
          grow
          onChange={(theme) => {
            prefs.set('theme', theme)
          }}
        />
      </Row>
    </Panel>
  )
}
