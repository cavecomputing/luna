import { useEffect, useState } from 'react'
import type { ToolInfo } from '../../../../shared/tools.js'
import { Panel } from '../panel.js'
import styles from './tools.module.css'

function message(code: string): string {
  if (code === 'tool/missing') return 'That tool is no longer available.'
  if (code === 'tool/not-enabled') return 'Enable the tool before changing how it asks.'
  if (code === 'tool/invalid') return 'That request was not valid.'
  return 'The change could not be saved.'
}

/**
 * What a tool says about itself, shown as its own claim.
 *
 * The protocol requires clients to treat annotations as untrusted, so this is
 * attributed copy for a person to weigh — nothing branches on it.
 */
function claims(tool: ToolInfo): string[] {
  const notes: string[] = []
  const annotations = tool.definition.annotations
  if (annotations?.readOnlyHint === true) notes.push('Only reads')
  if (annotations?.destructiveHint === true) notes.push('May delete or overwrite')
  if (annotations?.openWorldHint === true) notes.push('Reaches external services')
  return notes
}

function standingLabel(tool: ToolInfo): string | undefined {
  if (tool.standing === 'new') return 'New — not enabled'
  if (tool.standing === 'changed') return 'Changed — re-approve'
  return undefined
}

export function Tools(): React.JSX.Element {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [status, setStatus] = useState('')
  const [isBusy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.luna.tools.list().then((result) => {
      if (!live) return
      if (result.ok) setTools(result.value)
      else setStatus('Tools could not be loaded.')
    })
    const unsubscribe = window.luna.onTools((value) => {
      setTools(value)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  async function toggle(tool: ToolInfo, enabled: boolean): Promise<void> {
    setBusy(true)
    setStatus('')
    const result = await window.luna.tools.setEnabled(tool.source, tool.definition.name, enabled)
    setBusy(false)
    if (!result.ok) {
      setStatus(message(result.code))
      return
    }
    setTools(result.value)
  }

  async function requireApproval(tool: ToolInfo): Promise<void> {
    setBusy(true)
    setStatus('')
    const result = await window.luna.tools.requireApproval(tool.source, tool.definition.name)
    setBusy(false)
    if (!result.ok) {
      setStatus(message(result.code))
      return
    }
    setTools(result.value)
  }

  return (
    <Panel
      title="Tools"
      description="Tools let the model act outside this conversation. Each one stays off until you turn it on."
    >
      {tools.length === 0 ? (
        <p className={styles.empty}>No tools are available yet.</p>
      ) : (
        <ul className={styles.list}>
          {tools.map((tool) => {
            const flag = standingLabel(tool)
            const notes = claims(tool)
            return (
              <li className={styles.tool} key={`${tool.source}:${tool.definition.name}`}>
                <div className={styles.head}>
                  <span className={styles.name}>{tool.definition.title ?? tool.definition.name}</span>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={tool.enabled}
                      disabled={isBusy}
                      onChange={(event) => {
                        void toggle(tool, event.target.checked)
                      }}
                    />
                    <span>{tool.enabled ? 'Enabled' : 'Off'}</span>
                  </label>
                </div>

                <span className={styles.meta}>
                  {tool.sourceLabel} · {tool.definition.name}
                </span>
                {flag !== undefined && <span className={styles.flag}>{flag}</span>}

                <p className={styles.desc}>{tool.definition.description}</p>
                {notes.length > 0 && (
                  <span className={styles.claims}>The tool reports: {notes.join(' · ')}</span>
                )}

                {tool.enabled && (
                  <div className={styles.consent}>
                    {tool.policy === 'allow' ? (
                      <>
                        <span className={styles.standing}>Runs without asking.</span>
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={isBusy}
                          onClick={() => {
                            void requireApproval(tool)
                          }}
                        >
                          Ask every time
                        </button>
                      </>
                    ) : (
                      <span className={styles.standing}>Asks before every use.</span>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {status !== '' && (
        <p className={styles.status} role="alert">
          {status}
        </p>
      )}
    </Panel>
  )
}
