import { NotYet, Panel } from '../panel.js'

export function Models(): React.JSX.Element {
  return (
    <Panel
      title="Models"
      description="Fast is for quick, cheap replies. Expert is the larger model for harder work. Each picks a provider, a model and its own sampling."
    >
      <NotYet>Model slots and sampling controls come with the provider work.</NotYet>
    </Panel>
  )
}
