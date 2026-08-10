import type { MenuItemConstructorOptions, WebContents } from 'electron'
import { err, ok, type Result } from '../../shared/result.js'
import * as chats from '../chats.js'
import type { MessageAction } from '../chats.js'
import { coordinator } from './chat.js'
import { handle } from './bus.js'

type Deps = {
  getMessage: (id: string) => MessageAction | undefined
  retry: (id: string) => void
  show: (message: MessageAction, retry: () => void) => void
}

function object(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? { ...input } : undefined
}

function id(input: unknown): string | undefined {
  return typeof input === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(input)
    ? input
    : undefined
}

export function showMessageMenu(input: unknown, d: Deps): Result<undefined> {
  const messageId = id(object(input)?.id)
  if (messageId === undefined) return err('message/invalid', 'message id was invalid')
  const message = d.getMessage(messageId)
  if (message === undefined) return err('message/missing', 'message was not found')
  d.show(message, () => {
    d.retry(message.id)
  })
  return ok(undefined)
}

async function popup(
  sender: WebContents,
  message: MessageAction,
  retry: () => void,
): Promise<void> {
  const { BrowserWindow, Menu, clipboard } = await import('electron')
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Copy Message',
      enabled: message.text !== '',
      click: () => {
        clipboard.writeText(message.text)
      },
    },
    ...(message.retryable
      ? [
          { type: 'separator' as const },
          { label: 'Retry Response', click: retry },
        ]
      : []),
  ]
  const menu = Menu.buildFromTemplate(template)
  const window = BrowserWindow.fromWebContents(sender)
  menu.popup(window === null ? {} : { window })
}

export function register(): void {
  handle('messages:menu', (event, req) =>
    showMessageMenu(req, {
      getMessage: chats.action,
      retry: (id) => {
        void coordinator.retry({ messageId: id }).catch(() => undefined)
      },
      show: (message, retry) => {
        void popup(event.sender, message, retry).catch(() => undefined)
      },
    }),
  )
}
