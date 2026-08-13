import { describe, expect, it, vi } from 'vitest'
import type { Prefs } from '../../shared/prefs.js'
import type { Conversation, ModelSlots, Provider } from '../../shared/types.js'
import { deleteAll, exportAll } from './privacy.js'

type TestDeps = Parameters<typeof deleteAll>[0]

const conversation: Conversation = {
  id: 'chat-1',
  title: 'Synthetic',
  draft: '',
  icon: 'spark',
  mode: 'fast',
  pinned: false,
  updatedAt: 1,
  messages: [],
}

const preferences: Prefs = {
  theme: 'luna-light',
  defaultMode: 'fast',
  autoTitle: false,
  stream: true,
  sidebarWidth: 264,
}

const slots: ModelSlots = {
  fast: { providerId: null, model: '' },
  expert: { providerId: null, model: '' },
}

/**
 * Records the order side effects ran in, so the tests can assert sequencing
 * rather than just that each step happened.
 */
function makeDeps(order: string[] = []): TestDeps {
  const note =
    (label: string) =>
    <T,>(value: T): T => {
      order.push(label)
      return value
    }
  return {
    chats: vi.fn(() => [] as Conversation[]),
    archive: {
      pickFolder: vi.fn(() => Promise.resolve(undefined)),
      load: vi.fn(() => Promise.resolve([])),
      makeDir: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      now: () => 1_700_000_000_000,
      version: () => '0.1.0',
    },
    confirm: vi.fn(() => Promise.resolve(true)),
    stopStreams: vi.fn(() => {
      note('stopStreams')(undefined)
    }),
    settleStreams: vi.fn(() => {
      note('settleStreams')(undefined)
      return Promise.resolve()
    }),
    clearPreviews: vi.fn(() => {
      note('clearPreviews')(undefined)
    }),
    clearKeys: vi.fn(() => {
      note('clearKeys')(undefined)
      return Promise.resolve()
    }),
    clearBrowsingData: vi.fn(() => {
      note('clearBrowsingData')(undefined)
      return Promise.resolve()
    }),
    eraseDatabase: vi.fn(() => {
      note('eraseDatabase')(undefined)
      return Promise.resolve()
    }),
    prefs: vi.fn(() => preferences),
    applyTheme: vi.fn(() => {
      note('applyTheme')(undefined)
    }),
    providers: vi.fn(() => Promise.resolve([] as Provider[])),
    slots: vi.fn(() => slots),
    notifyPrefs: vi.fn(() => {
      note('notifyPrefs')(undefined)
    }),
    notifyProviders: vi.fn(() => {
      note('notifyProviders')(undefined)
    }),
    notifyModels: vi.fn(() => {
      note('notifyModels')(undefined)
    }),
    notifyChats: vi.fn(() => {
      note('notifyChats')(undefined)
    }),
    notifyAttachmentStorage: vi.fn(() => {
      note('notifyAttachmentStorage')(undefined)
    }),
  }
}

describe('exportAll', () => {
  it('reports how many conversations were written', async () => {
    const d = makeDeps()
    d.chats = vi.fn(() => [conversation])
    d.archive = { ...d.archive, pickFolder: vi.fn(() => Promise.resolve('/tmp/destination')) }

    expect(await exportAll(d)).toEqual({ ok: true, value: { written: 1 } })
  })

  it('reports nothing written when the destination is not chosen', async () => {
    expect(await exportAll(makeDeps())).toEqual({ ok: true, value: { written: 0 } })
  })

  it('returns privacy/export when the export fails', async () => {
    const d = makeDeps()
    d.chats = vi.fn(() => [conversation])
    d.archive = {
      ...d.archive,
      pickFolder: vi.fn(() => Promise.resolve('/tmp/destination')),
      write: vi.fn(() => Promise.reject(new Error('synthetic failure'))),
    }

    expect(await exportAll(d)).toMatchObject({ ok: false, code: 'privacy/export' })
  })
})

describe('deleteAll', () => {
  it('erases everything and announces the empty state', async () => {
    const order: string[] = []
    const d = makeDeps(order)

    expect(await deleteAll(d)).toEqual({ ok: true, value: { deleted: true } })

    expect(order).toEqual([
      'stopStreams',
      'settleStreams',
      'clearPreviews',
      // Credentials go before the database: a crash between them must not leave
      // a decryptable key on disk with nothing in the app recording it.
      'clearKeys',
      'clearBrowsingData',
      'eraseDatabase',
      // Theme is applied before it is announced, so native chrome and both
      // renderers agree on the first frame after the reset.
      'applyTheme',
      'notifyPrefs',
      'notifyProviders',
      'notifyModels',
      'notifyChats',
      'notifyAttachmentStorage',
    ])
    expect(d.notifyPrefs).toHaveBeenCalledWith(preferences)
    expect(d.notifyProviders).toHaveBeenCalledWith([])
    expect(d.notifyModels).toHaveBeenCalledWith(slots)
    expect(d.notifyChats).toHaveBeenCalledWith([])
    expect(d.notifyAttachmentStorage).toHaveBeenCalledOnce()
  })

  it('changes nothing when the confirmation is cancelled', async () => {
    const d = makeDeps()
    d.confirm = vi.fn(() => Promise.resolve(false))

    expect(await deleteAll(d)).toEqual({ ok: true, value: { deleted: false } })

    expect(d.stopStreams).not.toHaveBeenCalled()
    expect(d.clearKeys).not.toHaveBeenCalled()
    expect(d.eraseDatabase).not.toHaveBeenCalled()
    expect(d.notifyChats).not.toHaveBeenCalled()
  })

  it('returns privacy/busy for a second delete while the first is confirming', async () => {
    const first = makeDeps()
    let allow = (value: boolean): void => void value
    first.confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          allow = resolve
        }),
    )
    const pending = deleteAll(first)

    expect(await deleteAll(makeDeps())).toMatchObject({ ok: false, code: 'privacy/busy' })

    allow(false)
    await pending
    expect(first.confirm).toHaveBeenCalledOnce()
  })

  it('keeps the database when stored credentials cannot be removed', async () => {
    const d = makeDeps()
    d.clearKeys = vi.fn(() => Promise.reject(new Error('synthetic failure')))

    expect(await deleteAll(d)).toMatchObject({ ok: false, code: 'secret/unavailable' })

    expect(d.eraseDatabase).not.toHaveBeenCalled()
    expect(d.notifyChats).not.toHaveBeenCalled()
  })

  it('returns privacy/failed when the database cannot be replaced', async () => {
    const d = makeDeps()
    d.eraseDatabase = vi.fn(() => Promise.reject(new Error('synthetic failure')))

    expect(await deleteAll(d)).toMatchObject({ ok: false, code: 'privacy/failed' })

    // The keys are already gone. That half-state is deliberate, and the
    // renderer message for this code has to say so.
    expect(d.clearKeys).toHaveBeenCalled()
    expect(d.notifyChats).not.toHaveBeenCalled()
  })

  it('reports the deliberate half-state when browsing data cannot be cleared', async () => {
    const d = makeDeps()
    d.clearBrowsingData = vi.fn(() => Promise.reject(new Error('synthetic failure')))

    expect(await deleteAll(d)).toMatchObject({ ok: false, code: 'privacy/failed' })

    expect(d.clearKeys).toHaveBeenCalled()
    expect(d.eraseDatabase).not.toHaveBeenCalled()
    expect(d.notifyChats).not.toHaveBeenCalled()
  })

  it('allows another delete after one fails', async () => {
    const failing = makeDeps()
    failing.eraseDatabase = vi.fn(() => Promise.reject(new Error('synthetic failure')))
    await deleteAll(failing)

    expect(await deleteAll(makeDeps())).toEqual({ ok: true, value: { deleted: true } })
  })

  it('still reports success when announcing the empty state throws', async () => {
    const d = makeDeps()
    d.providers = vi.fn(() => Promise.reject(new Error('synthetic failure')))

    expect(await deleteAll(d)).toEqual({ ok: true, value: { deleted: true } })
    expect(d.eraseDatabase).toHaveBeenCalled()
  })
})
