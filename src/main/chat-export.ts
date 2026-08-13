import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { err, ok, type Result } from '../shared/result.js'
import type { AttachmentMeta, Conversation, Message } from '../shared/types.js'
import type { HistoryAttachment } from './attachment-jobs.js'

type Deps = {
  pick: (name: string) => Promise<string | undefined>
  load: (conversationId: string) => Promise<HistoryAttachment[] | undefined>
  write: (file: string, data: string) => Promise<void>
  now: () => number
}

/** Exporting every conversation at once, into a folder the user chose. */
export type ArchiveDeps = {
  pickFolder: () => Promise<string | undefined>
  load: (conversationId: string) => Promise<HistoryAttachment[] | undefined>
  /** Must reject when the directory already exists, so exports never merge. */
  makeDir: (dir: string) => Promise<void>
  write: (file: string, data: string) => Promise<void>
  now: () => number
  version: () => string
}

export type ArchiveEntry = {
  file: string
  title: string
  updatedAt: string
  messages: number
}

function exportedAttachment(
  messageId: string,
  attachment: AttachmentMeta,
  content: Map<string, HistoryAttachment>,
): Record<string, unknown> {
  const stored = content.get(attachment.id)
  if (stored?.messageId !== messageId) {
    throw new Error('conversation attachment content was missing')
  }
  return {
    name: attachment.name,
    kind: attachment.kind,
    mediaType: attachment.mediaType,
    size: attachment.size,
    encoding: 'base64',
    data: Buffer.from(stored.data).toString('base64'),
  }
}

function exportedMessage(
  message: Message,
  content: Map<string, HistoryAttachment>,
): Record<string, unknown> {
  return {
    role: message.role,
    text: message.text,
    ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    status: message.status,
    at: new Date(message.at).toISOString(),
    attachments: message.attachments.map((attachment) =>
      exportedAttachment(message.id, attachment, content),
    ),
  }
}

export function exportJson(
  chat: Conversation,
  attachments: HistoryAttachment[],
  now: number,
): string {
  const content = new Map(attachments.map((attachment) => [attachment.id, attachment]))
  return `${JSON.stringify(
    {
      format: 'luna-conversation',
      version: 1,
      exportedAt: new Date(now).toISOString(),
      conversation: {
        title: chat.title,
        mode: chat.mode,
        updatedAt: new Date(chat.updatedAt).toISOString(),
        messages: chat.messages.map((message) => exportedMessage(message, content)),
      },
    },
    null,
    2,
  )}\n`
}

export function exportName(title: string): string {
  const safe = Array.from(title, (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 || '<>:"/\\|?*'.includes(character) ? '-' : character
  }).join('')
  const cleaned = Array.from(
    safe.replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, ''),
  )
    .slice(0, 120)
    .join('')
    .replace(/[. ]+$/g, '')
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)
  const name = cleaned === '' ? 'Luna conversation' : reserved ? `Luna - ${cleaned}` : cleaned
  return `${name}.json`
}

/**
 * A name that collides with nothing in `used`, compared case-insensitively
 * because both macOS and Windows default to case-insensitive filesystems. The
 * chosen name is added to `used`.
 */
export function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const extension = dot === -1 ? '' : name.slice(dot)
  let candidate = name

  for (let attempt = 2; used.has(candidate.toLowerCase()); attempt += 1) {
    candidate = `${stem} ${String(attempt)}${extension}`
  }

  used.add(candidate.toLowerCase())
  return candidate
}

export function manifestJson(entries: ArchiveEntry[], now: number, version: string): string {
  return `${JSON.stringify(
    {
      format: 'luna-export',
      version: 1,
      exportedAt: new Date(now).toISOString(),
      app: version,
      conversations: entries,
    },
    null,
    2,
  )}\n`
}

/**
 * A fresh folder under the chosen root. Never reuses an existing one: a second
 * export into the same directory would leave the first export's files behind
 * and the manifest would not describe them.
 */
async function makeArchiveDir(root: string, now: number, d: ArchiveDeps): Promise<string> {
  const base = join(root, `Luna Export ${new Date(now).toISOString().slice(0, 10)}`)

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const dir = attempt === 1 ? base : `${base} ${String(attempt)}`
    try {
      await d.makeDir(dir)
      return dir
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error
      }
    }
  }

  throw new Error('no export folder name was available')
}

/**
 * One conversation JSON per file, in the same format a single export produces,
 * plus a manifest describing them.
 *
 * Serialization is CPU work — base64 of every attachment — so it runs one
 * conversation at a time. Each await hands the event loop back, which keeps the
 * longest uninterrupted block down to a single conversation instead of the
 * whole database.
 */
export async function saveArchive(chats: Conversation[], d: ArchiveDeps): Promise<Result<number>> {
  try {
    const root = await d.pickFolder()
    if (root === undefined) return ok(0)
    const now = d.now()
    const dir = await makeArchiveDir(root, now, d)
    await d.makeDir(join(dir, 'conversations'))
    const used = new Set<string>()
    const entries: ArchiveEntry[] = []

    for (const chat of chats) {
      const attachments = await d.load(chat.id)
      if (attachments === undefined) {
        return err('privacy/export', 'conversation attachments could not be read')
      }
      const name = uniqueName(exportName(chat.title), used)
      await d.write(join(dir, 'conversations', name), exportJson(chat, attachments, now))
      entries.push({
        file: `conversations/${name}`,
        title: chat.title,
        updatedAt: new Date(chat.updatedAt).toISOString(),
        messages: chat.messages.length,
      })
    }

    // Written last, so an interrupted export is visibly incomplete.
    await d.write(join(dir, 'manifest.json'), manifestJson(entries, now, d.version()))
    return ok(entries.length)
  } catch {
    return err('privacy/export', 'conversation export failed')
  }
}

export async function saveExport(chat: Conversation, d: Deps): Promise<Result<undefined>> {
  try {
    const file = await d.pick(exportName(chat.title))
    if (file === undefined) return ok(undefined)
    const attachments = await d.load(chat.id)
    if (attachments === undefined) return err('chat/export', 'conversation attachments could not be read')
    await d.write(file, exportJson(chat, attachments, d.now()))
    return ok(undefined)
  } catch {
    return err('chat/export', 'conversation export failed')
  }
}
