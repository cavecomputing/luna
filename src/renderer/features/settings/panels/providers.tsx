import { NotYet, Panel } from '../panel.js'

export function Providers(): React.JSX.Element {
  return (
    <Panel
      title="Providers"
      description="OpenAI-compatible endpoints. Add one per service, then point Fast and Expert at them under Models."
    >
      <NotYet>
        Provider list, connection test and key storage land next. Keys will be held in the
        macOS Keychain and never sent back to this window.
      </NotYet>
    </Panel>
  )
}
