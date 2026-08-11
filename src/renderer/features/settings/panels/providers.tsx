import { useEffect, useState } from 'react'
import type { Provider, ProviderDraft } from '../../../../shared/types.js'
import { Panel } from '../panel.js'
import styles from './providers.module.css'

const blank: ProviderDraft = {
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  api: 'responses',
  organization: '',
  project: '',
}

type Editor = {
  id: string | null
  provider: ProviderDraft
  hasApiKey: boolean
}

function message(code: string): string {
  switch (code) {
    case 'provider/auth':
      return 'The server rejected this API key.'
    case 'provider/not-found':
      return 'The server does not expose an OpenAI-compatible /models endpoint.'
    case 'provider/rate-limit':
      return 'The server is rate limiting requests. Try again shortly.'
    case 'provider/network':
      return 'Luna could not reach the server. Check the URL and network connection.'
    case 'provider/bad-response':
      return 'The server returned a model list Luna could not read.'
    case 'provider/missing':
      return 'That provider no longer exists.'
    case 'provider/invalid':
      return 'Check the provider name, URL, and optional IDs.'
    case 'secret/unavailable':
      return 'Secure credential storage is unavailable on this computer.'
    default:
      return 'The provider request could not be completed.'
  }
}

function edit(provider: Provider): Editor {
  const { id, hasApiKey, ...draft } = provider
  return { id, provider: draft, hasApiKey }
}

export function plainRemoteUrl(input: string): boolean {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return host !== 'localhost' && host !== '::1' && host !== '[::1]' && !host.startsWith('127.')
}

export function Providers(): React.JSX.Element {
  const [providers, setProviders] = useState<Provider[]>([])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState('')
  const [isBusy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.luna.providers.list().then((result) => {
      if (live && result.ok) setProviders(result.value)
    })
    const unsubscribe = window.luna.onProviders((value) => {
      setProviders(value)
      setEditor((current) => {
        if (current?.id === null || current === null) return current
        const updated = value.find((provider) => provider.id === current.id)
        return updated === undefined
          ? null
          : { ...current, hasApiKey: updated.hasApiKey }
      })
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  function field<K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]): void {
    setEditor((current) =>
      current === null
        ? current
        : { ...current, provider: { ...current.provider, [key]: value } },
    )
    setStatus('')
  }

  async function save(): Promise<Provider | undefined> {
    if (editor === null) return undefined
    setBusy(true)
    setStatus('')

    const result =
      editor.id === null
        ? await window.luna.providers.create(editor.provider)
        : await window.luna.providers.update(editor.id, editor.provider)
    if (!result.ok) {
      setBusy(false)
      setStatus(message(result.code))
      return undefined
    }

    let saved = result.value
    if (apiKey !== '') {
      const keyed = await window.luna.providers.setKey(saved.id, apiKey)
      if (!keyed.ok) {
        setBusy(false)
        setStatus(message(keyed.code))
        return undefined
      }
      saved = keyed.value
      setApiKey('')
    }

    setEditor(edit(saved))
    setBusy(false)
    setStatus('Saved.')
    return saved
  }

  async function test(): Promise<void> {
    const saved = await save()
    if (saved === undefined) return
    setBusy(true)
    setStatus('Checking the model endpoint…')
    const result = await window.luna.providers.models(saved.id)
    setBusy(false)
    setStatus(
      result.ok
        ? `Connected. The server returned ${String(result.value.length)} model${result.value.length === 1 ? '' : 's'}.`
        : message(result.code),
    )
  }

  async function clearKey(): Promise<void> {
    if (editor?.id === null || editor === null) return
    setBusy(true)
    const result = await window.luna.providers.setKey(editor.id, null)
    setBusy(false)
    setStatus(result.ok ? 'API key removed.' : message(result.code))
    if (result.ok) setEditor(edit(result.value))
  }

  async function remove(): Promise<void> {
    if (editor?.id === null || editor === null) return
    if (!window.confirm(`Delete ${editor.provider.name}? Fast or Expert assignments using it will be disconnected.`)) return
    setBusy(true)
    const result = await window.luna.providers.delete(editor.id)
    setBusy(false)
    if (result.ok) {
      setEditor(null)
      setApiKey('')
      setStatus('')
    } else {
      setStatus(message(result.code))
    }
  }

  return (
    <Panel
      title="Providers"
      description="Configure OpenAI or another server that implements the OpenAI HTTP API. Provider credentials never come back to this window."
    >
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {providers.length === 0
            ? 'No providers configured'
            : `${String(providers.length)} provider${providers.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            setEditor({ id: null, provider: blank, hasApiKey: false })
            setApiKey('')
            setStatus('')
          }}
        >
          Add provider
        </button>
      </div>

      {providers.length > 0 && (
        <div className={styles.list}>
          {providers.map((provider) => (
            <button
              type="button"
              className={styles.provider}
              key={provider.id}
              onClick={() => {
                setEditor(edit(provider))
                setApiKey('')
                setStatus('')
              }}
            >
              <span className={styles.providerName}>{provider.name}</span>
              <span className={styles.providerMeta}>
                {provider.api === 'responses' ? 'Responses API' : 'Chat Completions'} ·{' '}
                {provider.hasApiKey ? 'Key stored' : 'No key'}
              </span>
              <span className={styles.providerUrl}>{provider.baseUrl}</span>
            </button>
          ))}
        </div>
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
            <h2>{editor.id === null ? 'New provider' : `Edit ${editor.provider.name}`}</h2>
            <button
              type="button"
              className={styles.close}
              aria-label="Close provider editor"
              onClick={() => {
                setEditor(null)
                setStatus('')
                setApiKey('')
              }}
            >
              ×
            </button>
          </div>

          <label className={styles.field}>
            <span>Name</span>
            <input
              required
              maxLength={80}
              value={editor.provider.name}
              placeholder="OpenAI"
              onChange={(event) => {
                field('name', event.target.value)
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Base URL</span>
            <input
              required
              type="url"
              value={editor.provider.baseUrl}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              onChange={(event) => {
                field('baseUrl', event.target.value)
              }}
            />
            <small>Luna appends /models for discovery. HTTP is allowed but is not encrypted.</small>
          </label>

          <label className={styles.field}>
            <span>Conversation API</span>
            <select
              value={editor.provider.api}
              onChange={(event) => {
                field(
                  'api',
                  event.target.value === 'chat-completions' ? 'chat-completions' : 'responses',
                )
              }}
            >
              <option value="responses">Responses API (recommended)</option>
              <option value="chat-completions">Chat Completions (compatibility)</option>
            </select>
            <small>This is saved now and will govern requests when chat transport is added.</small>
          </label>

          <div className={styles.columns}>
            <label className={styles.field}>
              <span>Organization ID</span>
              <input
                maxLength={128}
                value={editor.provider.organization}
                placeholder="Optional"
                spellCheck={false}
                onChange={(event) => {
                  field('organization', event.target.value)
                }}
              />
            </label>
            <label className={styles.field}>
              <span>Project ID</span>
              <input
                maxLength={128}
                value={editor.provider.project}
                placeholder="Optional"
                spellCheck={false}
                onChange={(event) => {
                  field('project', event.target.value)
                }}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={editor.hasApiKey ? 'Stored securely — enter to replace' : 'Optional for keyless local servers'}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setApiKey(event.target.value)
                setStatus('')
              }}
            />
          </label>

          {editor.hasApiKey && plainRemoteUrl(editor.provider.baseUrl) && (
            <p className={styles.warning} role="alert">
              This API key will be sent over an unencrypted HTTP connection. Use HTTPS when the server supports it.
            </p>
          )}

          {status !== '' && <p className={styles.status}>{status}</p>}

          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={isBusy}>
              Save
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={isBusy}
              onClick={() => {
                void test()
              }}
            >
              Save & test
            </button>
            {editor.hasApiKey && (
              <button
                type="button"
                className={styles.secondary}
                disabled={isBusy}
                onClick={() => {
                  void clearKey()
                }}
              >
                Remove key
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
    </Panel>
  )
}
