import { useEffect, useState } from 'react'
import {
  MAX_ARGUMENT,
  MAX_COMMAND,
  MAX_ENV_VALUE,
  MAX_SERVER_NAME,
  isEnvName,
  type McpServerDraft,
  type McpServerInfo,
} from '../../../../shared/mcp.js'
import { Toggle } from '../../../ui/toggle.js'
import { Panel } from '../panel.js'
import styles from './servers.module.css'

const blank: McpServerDraft = { name: '', command: '', args: [], cwd: null, envNames: [] }

function message(code: string): string {
  switch (code) {
    case 'mcp/missing':
      return 'That server no longer exists.'
    case 'mcp/invalid':
      return 'Check the name, command, working directory, and variable names.'
    case 'secret/unavailable':
      return 'Secure credential storage is unavailable on this computer.'
    case 'rpc/spawn':
      return 'The command could not be started. Check the path and the arguments.'
    case 'rpc/timeout':
      return 'The server did not answer in time.'
    case 'mcp/unsupported':
      return 'The server does not speak a version of MCP that Luna supports.'
    case 'tool/no-credentials':
      return 'Luna could not read this server’s stored variables.'
    case 'tool/cooling-down':
      return 'The server failed recently. Use Restart to try it again now.'
    default:
      return 'The change could not be saved.'
  }
}

/** What the row says under the name, worst news first. */
function statusLine(server: McpServerInfo): string {
  if (!server.enabled) return 'Off'
  if (server.status === 'failed') {
    return `Failed — ${message(server.errorCode ?? '')}`
  }
  if (server.status === 'starting') return 'Starting…'
  if (server.status === 'ready') {
    const count = server.toolCount
    return `Running · ${String(count)} tool${count === 1 ? '' : 's'}`
  }
  return 'On, not started yet'
}

/**
 * A command line as one editable string.
 *
 * Splitting on whitespace, not parsing a shell. Luna never hands this to a
 * shell, so quoting rules would be a fiction — an argument that genuinely
 * contains a space is rare enough to be worth not pretending about.
 */
function words(input: string): string[] {
  return input.split(/\s+/).filter((part) => part !== '')
}

function names(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

type Editor = {
  id: string | null
  draft: McpServerDraft
  /** The argument list as typed, so editing does not fight the split. */
  argsText: string
  envText: string
  hasEnv: boolean
}

function edit(server: McpServerInfo): Editor {
  return {
    id: server.id,
    draft: {
      name: server.name,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      envNames: server.envNames,
    },
    argsText: server.args.join(' '),
    envText: server.envNames.join(' '),
    hasEnv: server.hasEnv,
  }
}

export function Servers(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [isBusy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.luna.mcp.list().then((result) => {
      if (!live) return
      if (result.ok) setServers(result.value)
      else setStatus('Servers could not be loaded.')
    })
    const unsubscribe = window.luna.onServers((value) => {
      setServers(value)
      // Keep an open editor pointing at a server that still exists, and let it
      // learn that credentials were stored without discarding what is typed.
      setEditor((current) => {
        if (current?.id == null) return current
        const found = value.find((server) => server.id === current.id)
        return found === undefined ? null : { ...current, hasEnv: found.hasEnv }
      })
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  function open(next: Editor | null): void {
    setEditor(next)
    setValues({})
    setStatus('')
  }

  async function save(): Promise<McpServerInfo | undefined> {
    if (editor === null) return undefined
    setBusy(true)
    setStatus('')

    const draft: McpServerDraft = {
      ...editor.draft,
      args: words(editor.argsText),
      envNames: names(editor.envText),
    }
    const result =
      editor.id === null
        ? await window.luna.mcp.create(draft)
        : await window.luna.mcp.update(editor.id, draft)
    if (!result.ok) {
      setBusy(false)
      setStatus(message(result.code))
      return undefined
    }

    let saved = result.value
    const typed = Object.entries(values).filter(([name]) => saved.envNames.includes(name))
    if (typed.length > 0) {
      const stored = await window.luna.mcp.setEnv(saved.id, Object.fromEntries(typed))
      if (!stored.ok) {
        setBusy(false)
        setStatus(message(stored.code))
        return undefined
      }
      saved = stored.value
    }

    setEditor(edit(saved))
    setValues({})
    setBusy(false)
    setStatus('Saved.')
    return saved
  }

  async function toggle(server: McpServerInfo, enabled: boolean): Promise<void> {
    setBusy(true)
    setStatus('')
    const result = await window.luna.mcp.setEnabled(server.id, enabled)
    setBusy(false)
    if (!result.ok) {
      setStatus(message(result.code))
      return
    }
    if (enabled && !result.value.enabled) {
      setStatus('Cancelled. The server was not started.')
      return
    }
    if (result.value.status === 'failed') setStatus(message(result.value.errorCode ?? ''))
  }

  async function restart(server: McpServerInfo): Promise<void> {
    setBusy(true)
    setStatus('Restarting…')
    const result = await window.luna.mcp.restart(server.id)
    setBusy(false)
    if (!result.ok) {
      setStatus(message(result.code))
      return
    }
    setStatus(
      result.value.status === 'ready'
        ? `Connected. The server offers ${String(result.value.toolCount)} tool${result.value.toolCount === 1 ? '' : 's'}.`
        : message(result.value.errorCode ?? ''),
    )
  }

  async function clearEnv(): Promise<void> {
    if (editor?.id == null) return
    setBusy(true)
    const result = await window.luna.mcp.setEnv(editor.id, null)
    setBusy(false)
    setStatus(result.ok ? 'Stored variables removed.' : message(result.code))
    if (result.ok) setEditor(edit(result.value))
  }

  async function remove(): Promise<void> {
    if (editor?.id == null) return
    if (
      !window.confirm(
        `Delete ${editor.draft.name}? Its stored variables and every permission you granted its tools go with it.`,
      )
    ) {
      return
    }
    setBusy(true)
    const result = await window.luna.mcp.delete(editor.id)
    setBusy(false)
    if (result.ok) open(null)
    else setStatus(message(result.code))
  }

  const envNames = editor === null ? [] : names(editor.envText).filter(isEnvName)

  return (
    <Panel
      title="Servers"
      description="Connect Model Context Protocol servers. A server is a program on this computer, so Luna asks before it runs one, and every tool it offers stays off until you turn that tool on."
    >
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {servers.length === 0
            ? 'No servers configured'
            : `${String(servers.length)} server${servers.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            open({ id: null, draft: blank, argsText: '', envText: '', hasEnv: false })
          }}
        >
          Add server
        </button>
      </div>

      {servers.length > 0 && (
        <ul className={styles.list}>
          {servers.map((server) => (
            <li className={styles.server} key={server.id}>
              <button
                type="button"
                className={styles.identity}
                onClick={() => {
                  open(edit(server))
                }}
              >
                <span className={styles.name}>{server.name}</span>
                <span className={styles.meta}>{statusLine(server)}</span>
                <span className={styles.command}>
                  {[server.command, ...server.args].join(' ')}
                </span>
              </button>
              <div className={styles.rowActions}>
                <Toggle
                  label={`Run ${server.name}`}
                  checked={server.enabled}
                  onChange={(next) => {
                    if (isBusy) return
                    void toggle(server, next)
                  }}
                />
                {server.enabled && (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={isBusy}
                    onClick={() => {
                      void restart(server)
                    }}
                  >
                    Restart
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor !== null && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className={styles.formHead}>
            <h2>{editor.id === null ? 'New server' : `Edit ${editor.draft.name}`}</h2>
            <button
              type="button"
              className={styles.close}
              aria-label="Close server editor"
              onClick={() => {
                open(null)
              }}
            >
              ×
            </button>
          </div>

          <label className={styles.field}>
            <span>Name</span>
            <input
              required
              maxLength={MAX_SERVER_NAME}
              value={editor.draft.name}
              placeholder="Files"
              onChange={(event) => {
                const { value } = event.target
                setEditor((current) =>
                  current === null
                    ? current
                    : { ...current, draft: { ...current.draft, name: value } },
                )
                setStatus('')
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Command</span>
            <input
              required
              maxLength={MAX_COMMAND}
              spellCheck={false}
              value={editor.draft.command}
              placeholder="npx"
              onChange={(event) => {
                const { value } = event.target
                setEditor((current) =>
                  current === null
                    ? current
                    : { ...current, draft: { ...current.draft, command: value } },
                )
                setStatus('')
              }}
            />
            <small>The program to run. Luna runs it directly — never through a shell.</small>
          </label>

          <label className={styles.field}>
            <span>Arguments</span>
            <input
              maxLength={MAX_ARGUMENT}
              spellCheck={false}
              value={editor.argsText}
              placeholder="-y @modelcontextprotocol/server-filesystem /path/to/files"
              onChange={(event) => {
                const { value } = event.target
                setEditor((current) => (current === null ? current : { ...current, argsText: value }))
                setStatus('')
              }}
            />
            <small>Separated by spaces. There is no shell, so quotes are not interpreted.</small>
          </label>

          <label className={styles.field}>
            <span>Working directory</span>
            <input
              maxLength={MAX_COMMAND}
              spellCheck={false}
              value={editor.draft.cwd ?? ''}
              placeholder="Optional — must be an absolute path"
              onChange={(event) => {
                const { value } = event.target
                setEditor((current) =>
                  current === null
                    ? current
                    : {
                        ...current,
                        draft: { ...current.draft, cwd: value === '' ? null : value },
                      },
                )
                setStatus('')
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Environment variables</span>
            <input
              spellCheck={false}
              value={editor.envText}
              placeholder="GITHUB_TOKEN API_KEY"
              onChange={(event) => {
                const { value } = event.target
                setEditor((current) => (current === null ? current : { ...current, envText: value }))
                setStatus('')
              }}
            />
            <small>
              Names only. Their values are stored on this computer by the operating system and
              never come back to this window.
            </small>
          </label>

          {envNames.length > 0 && (
            <div className={styles.secrets}>
              {envNames.map((name) => (
                <label className={styles.field} key={name}>
                  <span>{name}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_ENV_VALUE}
                    value={values[name] ?? ''}
                    placeholder={
                      editor.hasEnv ? 'Stored securely — enter to replace' : 'Value for this server'
                    }
                    onChange={(event) => {
                      const { value } = event.target
                      setValues((current) => ({ ...current, [name]: value }))
                      setStatus('')
                    }}
                  />
                </label>
              ))}
            </div>
          )}

          {status !== '' && (
            <p className={styles.status} role="status">
              {status}
            </p>
          )}

          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={isBusy}>
              Save
            </button>
            {editor.hasEnv && (
              <button
                type="button"
                className={styles.secondary}
                disabled={isBusy}
                onClick={() => {
                  void clearEnv()
                }}
              >
                Remove stored values
              </button>
            )}
            {editor.id !== null && (
              <button
                type="button"
                className={styles.danger}
                disabled={isBusy}
                onClick={() => {
                  void remove()
                }}
              >
                Delete
              </button>
            )}
          </div>
        </form>
      )}

      {editor === null && status !== '' && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
    </Panel>
  )
}
