import type { WebContents } from 'electron'
import { err, ok, type Result } from '../../shared/result.js'
import * as chats from '../chats.js'
import { handle } from './bus.js'

type Deps = {
  getText: (id: string) => string | undefined
  show: (text: string) => void
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
  const text = d.getText(messageId)
  if (text === undefined) return err('message/missing', 'message was not found')
  d.show(text)
  return ok(undefined)
}

async function popup(sender: WebContents, text: string): Promise<void> {
  const { BrowserWindow, Menu, clipboard } = await import('electron')
  const menu = Menu.buildFromTemplate([
    {
      label: 'Copy Message',
      enabled: text !== '',
      click: () => {
        clipboard.writeText(text)
      },
    },
  ])
  const window = BrowserWindow.fromWebContents(sender)
  menu.popup(window === null ? {} : { window })
}

export function register(): void {
  handle('messages:menu', (event, req) =>
    showMessageMenu(req, {
      getText: chats.text,
      show: (text) => {
        void popup(event.sender, text).catch(() => undefined)
      },
    }),
  )
}
