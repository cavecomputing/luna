import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../shared/types.js'
import type { HistoryAttachment } from './attachment-jobs.js'
import {
  exportName,
  exportJson,
  manifestJson,
  saveArchive,
  saveExport,
  uniqueName,
  type ArchiveDeps,
} from './chat-export.js'

function chat(): Conversation {
  return {
    id: 'internal-chat-id',
    title: 'Weekend / notes',
    draft: 'private unfinished draft',
    icon: 'spark',
    mode: 'expert',
    pinned: true,
    updatedAt: 1_700_000_000_000,
    messages: [
      {
        id: 'internal-message-id',
        role: 'user',
        text: 'Synthetic question',
        status: 'complete',
        at: 1_699_999_000_000,
        attachments: [
          {
            id: 'internal-attachment-id',
            name: 'picture.png',
            kind: 'image',
            mediaType: 'image/png',
            size: 4,
          },
        ],
      },
    ],
  }
}

function attachments(): HistoryAttachment[] {
  return [
    {
      id: 'internal-attachment-id',
      messageId: 'internal-message-id',
      name: 'picture.png',
      kind: 'image',
      mediaType: 'image/png',
      size: 4,
      data: new Uint8Array([137, 80, 78, 71]),
    },
  ]
}

describe('conversation export', () => {
  it('creates readable versioned JSON without renderer or draft internals', () => {
    const value: unknown = JSON.parse(exportJson(chat(), attachments(), 1_700_000_100_000))

    expect(value).toEqual({
      format: 'luna-conversation',
      version: 1,
      exportedAt: '2023-11-14T22:15:00.000Z',
      conversation: {
        title: 'Weekend / notes',
        mode: 'expert',
        updatedAt: '2023-11-14T22:13:20.000Z',
        messages: [
          {
            role: 'user',
            text: 'Synthetic question',
            status: 'complete',
            at: '2023-11-14T21:56:40.000Z',
            attachments: [
              {
                name: 'picture.png',
                kind: 'image',
                mediaType: 'image/png',
                size: 4,
                encoding: 'base64',
                data: 'iVBORw==',
              },
            ],
          },
        ],
      },
    })
    expect(exportJson(chat(), attachments(), 1_700_000_100_000)).not.toContain(
      'private unfinished draft',
    )
    expect(exportJson(chat(), attachments(), 1_700_000_100_000)).not.toContain('internal-')
  })

  it('makes a safe JSON filename from the conversation title', () => {
    expect(exportName(' Weekend / notes: ideas? ')).toBe('Weekend - notes- ideas-.json')
    expect(exportName('...')).toBe('Luna conversation.json')
  })

  it('writes the selected export and treats cancellation as success', async () => {
    const write = vi.fn(() => Promise.resolve())
    const saved = await saveExport(chat(), {
      pick: vi.fn(() => Promise.resolve('/tmp/weekend.json')),
      load: vi.fn(() => Promise.resolve(attachments())),
      write,
      now: () => 1_700_000_100_000,
    })
    const cancelled = await saveExport(chat(), {
      pick: vi.fn(() => Promise.resolve(undefined)),
      load: vi.fn(() => Promise.resolve(attachments())),
      write,
      now: () => 1_700_000_100_000,
    })

    expect(saved).toEqual({ ok: true, value: undefined })
    expect(cancelled).toEqual({ ok: true, value: undefined })
    expect(write).toHaveBeenCalledOnce()
  })

  it('returns chat/export when the file cannot be written', async () => {
    const result = await saveExport(chat(), {
      pick: vi.fn(() => Promise.resolve('/tmp/weekend.json')),
      load: vi.fn(() => Promise.resolve(attachments())),
      write: vi.fn(() => Promise.reject(new Error('synthetic failure'))),
      now: () => 1_700_000_100_000,
    })

    expect(result).toMatchObject({ ok: false, code: 'chat/export' })
  })

  it('returns chat/export when the destination picker fails', async () => {
    const result = await saveExport(chat(), {
      pick: vi.fn(() => Promise.reject(new Error('synthetic failure'))),
      load: vi.fn(() => Promise.resolve(attachments())),
      write: vi.fn(() => Promise.resolve()),
      now: () => 1_700_000_100_000,
    })

    expect(result).toMatchObject({ ok: false, code: 'chat/export' })
  })

  it('returns chat/export when attachment content cannot be loaded', async () => {
    const result = await saveExport(chat(), {
      pick: vi.fn(() => Promise.resolve('/tmp/weekend.json')),
      load: vi.fn(() => Promise.resolve(undefined)),
      write: vi.fn(() => Promise.resolve()),
      now: () => 1_700_000_100_000,
    })

    expect(result).toMatchObject({ ok: false, code: 'chat/export' })
  })
})

describe('uniqueName', () => {
  it('numbers a repeated name without disturbing the extension', () => {
    const used = new Set<string>()

    expect(uniqueName('Notes.json', used)).toBe('Notes.json')
    expect(uniqueName('Notes.json', used)).toBe('Notes 2.json')
    expect(uniqueName('Notes.json', used)).toBe('Notes 3.json')
  })

  it('treats names differing only in case as the same file', () => {
    const used = new Set<string>()

    expect(uniqueName('Notes.json', used)).toBe('Notes.json')
    expect(uniqueName('NOTES.json', used)).toBe('NOTES 2.json')
  })
})

/** A second conversation, so archive tests cover ordering and collisions. */
function other(): Conversation {
  return {
    id: 'internal-other-id',
    title: 'Weekend / notes',
    draft: '',
    icon: 'leaf',
    mode: 'fast',
    pinned: false,
    updatedAt: 1_699_000_000_000,
    messages: [],
  }
}

function archiveDeps(overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    pickFolder: vi.fn(() => Promise.resolve('/tmp/destination')),
    load: vi.fn(() => Promise.resolve(attachments())),
    makeDir: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    now: () => 1_700_000_100_000,
    version: () => '0.1.0',
    ...overrides,
  }
}

describe('manifestJson', () => {
  it('describes the written files without leaking internal ids', () => {
    const value: unknown = JSON.parse(
      manifestJson(
        [
          {
            file: 'conversations/Weekend - notes.json',
            title: 'Weekend / notes',
            updatedAt: '2023-11-14T22:13:20.000Z',
            messages: 1,
          },
        ],
        1_700_000_100_000,
        '0.1.0',
      ),
    )

    expect(value).toEqual({
      format: 'luna-export',
      version: 1,
      exportedAt: '2023-11-14T22:15:00.000Z',
      app: '0.1.0',
      conversations: [
        {
          file: 'conversations/Weekend - notes.json',
          title: 'Weekend / notes',
          updatedAt: '2023-11-14T22:13:20.000Z',
          messages: 1,
        },
      ],
    })
  })
})

describe('saveArchive', () => {
  it('writes one file per conversation and a manifest describing them', async () => {
    const write = vi.fn<ArchiveDeps['write']>(() => Promise.resolve())
    const d = archiveDeps({ write })

    const result = await saveArchive([chat(), other()], d)

    expect(result).toEqual({ ok: true, value: 2 })
    const written = write.mock.calls.map((call) => call[0])
    expect(written).toEqual([
      '/tmp/destination/Luna Export 2023-11-14/conversations/Weekend - notes.json',
      '/tmp/destination/Luna Export 2023-11-14/conversations/Weekend - notes 2.json',
      '/tmp/destination/Luna Export 2023-11-14/manifest.json',
    ])
    const manifest: unknown = JSON.parse(String(write.mock.calls[2]?.[1]))
    expect(manifest).toMatchObject({
      format: 'luna-export',
      conversations: [
        { file: 'conversations/Weekend - notes.json', messages: 1 },
        { file: 'conversations/Weekend - notes 2.json', messages: 0 },
      ],
    })
  })

  it('writes nothing when the destination is not chosen', async () => {
    const write = vi.fn<ArchiveDeps['write']>(() => Promise.resolve())
    const makeDir = vi.fn(() => Promise.resolve())

    const result = await saveArchive(
      [chat()],
      archiveDeps({ pickFolder: vi.fn(() => Promise.resolve(undefined)), write, makeDir }),
    )

    expect(result).toEqual({ ok: true, value: 0 })
    expect(write).not.toHaveBeenCalled()
    expect(makeDir).not.toHaveBeenCalled()
  })

  it('keeps drafts and internal ids out of every written file', async () => {
    const write = vi.fn<ArchiveDeps['write']>(() => Promise.resolve())

    await saveArchive([chat(), other()], archiveDeps({ write }))

    for (const call of write.mock.calls) {
      expect(call[1]).not.toContain('private unfinished draft')
      expect(call[1]).not.toContain('internal-')
    }
  })

  it('numbers a second folder rather than merging into an existing export', async () => {
    const makeDir = vi.fn((dir: string) =>
      dir === '/tmp/destination/Luna Export 2023-11-14'
        ? Promise.reject(new Error('exists'))
        : Promise.resolve(),
    )
    const write = vi.fn<ArchiveDeps['write']>(() => Promise.resolve())

    const result = await saveArchive([chat()], archiveDeps({ makeDir, write }))

    expect(result).toEqual({ ok: true, value: 1 })
    expect(write.mock.calls[0]?.[0]).toBe(
      '/tmp/destination/Luna Export 2023-11-14 2/conversations/Weekend - notes.json',
    )
  })

  it.each([
    ['the destination picker fails', { pickFolder: vi.fn(() => Promise.reject(new Error('denied'))) }],
    ['attachments cannot be read', { load: vi.fn(() => Promise.resolve(undefined)) }],
    ['a file cannot be written', { write: vi.fn(() => Promise.reject(new Error('synthetic'))) }],
    ['the folder cannot be created', { makeDir: vi.fn(() => Promise.reject(new Error('denied'))) }],
  ])('returns privacy/export when %s', async (_label, overrides) => {
    const result = await saveArchive([chat()], archiveDeps(overrides))

    expect(result).toMatchObject({ ok: false, code: 'privacy/export' })
  })
})
