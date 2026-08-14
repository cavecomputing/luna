// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../shared/types.js'
import { defaultSamplerSettings } from '../shared/types.js'
import type { Chats } from './features/chats/use-chats.js'
import { App, ConversationSurface } from './app.js'

vi.mock('./features/composer/composer.js', () => ({
  Composer: () => <div data-testid="composer" />,
}))

vi.mock('./features/chats/sidebar.js', () => ({
  Sidebar: ({ collapse }: { collapse: React.ReactNode | null }) => (
    <aside data-testid="sidebar">{collapse}</aside>
  ),
}))

vi.mock('./features/chats/use-chats.js', () => ({
  useChats: () => ({
    open: undefined,
    openId: undefined,
    all: [],
    visible: [],
    currentMode: 'fast',
    streamingMessage: undefined,
    error: undefined,
    start: vi.fn(),
    send: vi.fn(),
    ensure: vi.fn(),
    cancel: vi.fn(),
    setDraft: vi.fn(),
    setMode: vi.fn(),
    setOpenId: vi.fn(),
  }),
}))

vi.mock('./features/mode/use-models.js', () => ({ useModels: () => ({}) }))
vi.mock('./features/mode/mode-switch.js', () => ({ ModeSwitch: () => <div /> }))
vi.mock('./lib/use-now.js', () => ({ useNow: () => 1 }))
vi.mock('./lib/use-prefs.js', () => ({
  usePrefs: () => ({
    prefs: { defaultMode: 'fast', sidebarWidth: 264 },
    set: vi.fn(),
  }),
}))

afterEach(cleanup)

function conversation(id: string, text?: string): Conversation {
  return {
    id,
    title: text === undefined ? 'New chat' : 'Existing chat',
    draft: '',
    icon: 'spark',
    mode: 'fast',
    pinned: false,
    updatedAt: 1,
    messages: text === undefined
      ? []
      : [{
          id: `${id}-message`,
          role: 'assistant',
          text,
          status: 'complete',
          at: 1,
          attachments: [],
        }],
  }
}

function chats(open: Conversation): Chats {
  return {
    open,
    openId: open.id,
    streamingMessage: undefined,
    error: undefined,
    send: vi.fn(),
    ensure: vi.fn(),
    cancel: vi.fn(),
    setDraft: vi.fn(),
  } as unknown as Chats
}

describe('ConversationSurface', () => {
  it('fully replaces the previous thread when a new chat opens', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const existing = conversation('existing', 'Previous conversation content')
    const models = {
      fast: { providerId: 'provider-1', model: 'fast-model', sampling: { ...defaultSamplerSettings } },
      expert: { providerId: 'provider-1', model: 'expert-model', sampling: { ...defaultSamplerSettings } },
    }
    const { container, rerender } = render(<ConversationSurface chats={chats(existing)} models={models} />)

    rerender(<ConversationSurface chats={chats(conversation('new'))} models={models} />)

    expect(screen.queryByText('Previous conversation content')).toBeNull()
    expect(screen.getByText('Hey there! I’m Luna.')).toBeTruthy()
    expect(container.querySelectorAll('article')).toHaveLength(0)
    expect(screen.getAllByTestId('composer')).toHaveLength(1)
  })
})

describe('App', () => {
  it('places the Windows collapse control inside the open sidebar', () => {
    Object.defineProperty(window, 'luna', {
      configurable: true,
      value: {
        platform: 'win32',
        app: { setModal: vi.fn() },
        settings: { open: vi.fn() },
        onNewChat: () => vi.fn(),
        onCommandPalette: () => vi.fn(),
        onToggleSidebar: () => vi.fn(),
        onToggleMode: () => vi.fn(),
      },
    })

    render(<App />)

    expect(within(screen.getByTestId('sidebar')).getByRole('button', { name: 'Hide sidebar' })).toBeTruthy()
  })
})
