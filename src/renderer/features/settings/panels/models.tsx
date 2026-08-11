import { useCallback, useEffect, useRef, useState } from 'react'
import {
  emptyModelSlots,
  type ModelSlots,
  type Mode,
  type Provider,
  type ProviderModel,
} from '../../../../shared/types.js'
import { useDebouncedValue } from '../../../lib/use-debounced-value.js'
import { Bolt } from '../../../ui/icons/bolt.js'
import { Crescent } from '../../../ui/icons/crescent.js'
import { Panel } from '../panel.js'
import styles from './models.module.css'

function errorMessage(code: string): string {
  switch (code) {
    case 'provider/auth':
      return 'API key rejected. Update it under Providers.'
    case 'provider/not-found':
      return 'This server does not expose /models. You can still type a model ID.'
    case 'provider/rate-limit':
      return 'Model discovery was rate limited. You can retry or type a model ID.'
    case 'provider/network':
      return 'The server could not be reached. You can still type a model ID.'
    case 'provider/bad-response':
      return 'The server returned an unreadable model list. You can still type a model ID.'
    case 'secret/unavailable':
      return 'The stored credential could not be read.'
    default:
      return 'Model discovery failed. You can still type a model ID.'
  }
}

type ModelDrafts = { fast: string; expert: string }
export type FlushModels = () => Promise<void>
export type RegisterFlush = (flush: FlushModels) => () => void

/**
 * Decides what the model inputs show after a `models:changed` broadcast.
 * A slot whose incoming value matches what this window last saved keeps its
 * local draft — the save round trip must not truncate what is being typed.
 * A different value came from somewhere else, so it wins.
 */
export function mergeDrafts(drafts: ModelDrafts, incoming: ModelSlots, saved: ModelSlots): ModelDrafts {
  return {
    fast: sameSlot(incoming.fast, saved.fast) ? drafts.fast : incoming.fast.model,
    expert: sameSlot(incoming.expert, saved.expert) ? drafts.expert : incoming.expert.model,
  }
}

function sameSlot(incoming: ModelSlots[Mode], saved: ModelSlots[Mode]): boolean {
  return incoming.providerId === saved.providerId && incoming.model === saved.model
}

type CardProps = {
  slot: Mode
  title: string
  description: string
  icon: React.ReactNode
  providers: Provider[]
  value: ModelSlots[Mode]
  draft: string
  models: ProviderModel[]
  status: string
  onProvider: (id: string | null) => void
  onModel: (value: string) => void
  onRefresh: () => void
}

function ModelCard({
  slot,
  title,
  description,
  icon,
  providers,
  value,
  draft,
  models,
  status,
  onProvider,
  onModel,
  onRefresh,
}: CardProps): React.JSX.Element {
  const selected = providers.find((provider) => provider.id === value.providerId)
  const listId = `${slot}-models`

  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <span className={styles.icon}>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>

      <label className={styles.field}>
        <span>Provider</span>
        <select
          value={value.providerId ?? ''}
          onChange={(event) => {
            onProvider(event.target.value === '' ? null : event.target.value)
          }}
        >
          <option value="">Choose a provider</option>
          {providers.map((provider) => (
            <option value={provider.id} key={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Model</span>
        <div className={styles.modelRow}>
          <input
            list={listId}
            value={draft}
            disabled={value.providerId === null}
            placeholder={value.providerId === null ? 'Choose a provider first' : 'Select or type a model ID'}
            spellCheck={false}
            onChange={(event) => {
              onModel(event.target.value)
            }}
          />
          <datalist id={listId}>
            {models.map((model) => (
              <option value={model.id} key={model.id} />
            ))}
          </datalist>
          <button
            type="button"
            className={styles.refresh}
            disabled={value.providerId === null}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
        <small>
          {selected === undefined
            ? 'Fast and Expert are configured independently.'
            : `${selected.api === 'responses' ? 'Responses API' : 'Chat Completions'} · Server models appear as suggestions; any exact model ID is accepted.`}
        </small>
      </label>

      {status !== '' && <p className={styles.status}>{status}</p>}
    </section>
  )
}

type ModelsProps = {
  registerFlush?: RegisterFlush
}

export function Models({ registerFlush }: ModelsProps = {}): React.JSX.Element {
  const [providers, setProviders] = useState<Provider[]>([])
  const [slots, setSlots] = useState<ModelSlots>(emptyModelSlots)
  const [drafts, setDrafts] = useState<ModelDrafts>({ fast: '', expert: '' })
  const [available, setAvailable] = useState<Record<string, ProviderModel[]>>({})
  const [status, setStatus] = useState({ fast: '', expert: '' })
  const [ready, setReady] = useState(false)
  // The value each slot was last saved with from this window. Lets the
  // broadcast handler tell its own round trips apart from outside changes.
  const saved = useRef<ModelSlots>({
    fast: { ...emptyModelSlots.fast },
    expert: { ...emptyModelSlots.expert },
  })
  const latest = useRef({ drafts, slots, ready })
  latest.current = { drafts, slots, ready }
  const fast = useDebouncedValue(drafts.fast, 300)
  const expert = useDebouncedValue(drafts.expert, 300)

  const flush = useCallback(async (): Promise<void> => {
    const current = latest.current
    if (!current.ready) return
    const pending = (['fast', 'expert'] as const).flatMap((slot) => {
      const model = current.drafts[slot]
      const value = current.slots[slot]
      if (model === value.model) return []
      saved.current[slot] = { providerId: value.providerId, model }
      return [window.luna.models.set(slot, value.providerId, model)]
    })
    await Promise.all(pending)
  }, [])

  useEffect(() => registerFlush?.(flush), [flush, registerFlush])

  useEffect(() => {
    let live = true
    void Promise.all([window.luna.providers.list(), window.luna.models.get()]).then(
      ([providerResult, slotResult]) => {
        if (!live) return
        if (providerResult.ok) setProviders(providerResult.value)
        if (slotResult.ok) {
          setSlots(slotResult.value)
          setDrafts({ fast: slotResult.value.fast.model, expert: slotResult.value.expert.model })
          saved.current = {
            fast: { ...slotResult.value.fast },
            expert: { ...slotResult.value.expert },
          }
          setReady(true)

          const ids = new Set(
            [slotResult.value.fast.providerId, slotResult.value.expert.providerId].filter(
              (id): id is string => id !== null,
            ),
          )
          for (const id of ids) {
            void window.luna.providers.models(id).then((result) => {
              if (live && result.ok) {
                setAvailable((current) => ({ ...current, [id]: result.value }))
              }
            })
          }
        }
      },
    )

    const offProviders = window.luna.onProviders(setProviders)
    const offModels = window.luna.onModels((value) => {
      setSlots(value)
      setDrafts((current) => mergeDrafts(current, value, saved.current))
      setReady(true)
    })
    return () => {
      live = false
      offProviders()
      offModels()
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    for (const slot of ['fast', 'expert'] as const) {
      const debounced = slot === 'fast' ? fast : expert
      if (debounced !== drafts[slot] || debounced === slots[slot].model) continue
      saved.current[slot] = { providerId: slots[slot].providerId, model: debounced }
      void window.luna.models.set(slot, slots[slot].providerId, debounced).then((result) => {
        if (!result.ok) {
          setStatus((current) => ({ ...current, [slot]: 'Model choice could not be saved.' }))
        }
      })
    }
  }, [drafts, expert, fast, ready, slots])

  async function choose(slot: Mode, providerId: string | null): Promise<void> {
    setDrafts((current) => ({ ...current, [slot]: '' }))
    setStatus((current) => ({ ...current, [slot]: '' }))
    saved.current[slot] = { providerId, model: '' }
    const result = await window.luna.models.set(slot, providerId, '')
    if (!result.ok) {
      setStatus((current) => ({ ...current, [slot]: 'Provider choice could not be saved.' }))
      return
    }
    if (providerId !== null) await refresh(slot, providerId)
  }

  async function refresh(slot: Mode, providerId: string | null): Promise<void> {
    if (providerId === null) return
    setStatus((current) => ({ ...current, [slot]: 'Loading models…' }))
    const result = await window.luna.providers.models(providerId)
    if (result.ok) {
      setAvailable((current) => ({ ...current, [providerId]: result.value }))
      setStatus((current) => ({
        ...current,
        [slot]: `${String(result.value.length)} model${result.value.length === 1 ? '' : 's'} available.`,
      }))
    } else {
      setStatus((current) => ({ ...current, [slot]: errorMessage(result.code) }))
    }
  }

  return (
    <Panel
      title="Models"
      description="Assign a provider and model to each mode. The two modes may share a provider or use completely different servers."
    >
      {providers.length === 0 && (
        <p className={styles.empty}>Add a provider first, then return here to assign models.</p>
      )}

      <ModelCard
        slot="fast"
        title="Fast"
        description="Optimized for low latency and everyday questions."
        icon={<Bolt size={16} />}
        providers={providers}
        value={slots.fast}
        draft={drafts.fast}
        models={slots.fast.providerId === null ? [] : (available[slots.fast.providerId] ?? [])}
        status={status.fast}
        onProvider={(id) => {
          void choose('fast', id)
        }}
        onModel={(value) => {
          setDrafts((current) => ({ ...current, fast: value }))
          setStatus((current) => ({ ...current, fast: '' }))
        }}
        onRefresh={() => {
          void refresh('fast', slots.fast.providerId)
        }}
      />

      <ModelCard
        slot="expert"
        title="Expert"
        description="Reserved for deeper reasoning and more demanding work."
        icon={<Crescent size={16} />}
        providers={providers}
        value={slots.expert}
        draft={drafts.expert}
        models={slots.expert.providerId === null ? [] : (available[slots.expert.providerId] ?? [])}
        status={status.expert}
        onProvider={(id) => {
          void choose('expert', id)
        }}
        onModel={(value) => {
          setDrafts((current) => ({ ...current, expert: value }))
          setStatus((current) => ({ ...current, expert: '' }))
        }}
        onRefresh={() => {
          void refresh('expert', slots.expert.providerId)
        }}
      />
    </Panel>
  )
}
