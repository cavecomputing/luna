// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpServerDraft, McpServerInfo } from '../../../../shared/mcp.js'
import { Servers } from './servers.js'

const server: McpServerInfo = {
  id: 'server-1',
  name: 'Files',
  command: 'npx',
  args: ['-y', '@example/files'],
  cwd: null,
  envNames: [],
  enabled: false,
  hasEnv: false,
  status: 'idle',
  toolCount: 0,
}

type Mcp = {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  setEnabled: ReturnType<typeof vi.fn>
  setEnv: ReturnType<typeof vi.fn>
  restart: ReturnType<typeof vi.fn>
}

function bridge(over: Partial<Mcp> = {}, servers: McpServerInfo[] = [server]): Mcp {
  const mcp: Mcp = {
    list: vi.fn(() => Promise.resolve({ ok: true as const, value: servers })),
    create: vi.fn(() => Promise.resolve({ ok: true as const, value: server })),
    // Echoes the draft, as the handler does: a value is only stored under a
    // name the save actually kept.
    update: vi.fn((id: string, draft: McpServerDraft) =>
      Promise.resolve({ ok: true as const, value: { ...server, ...draft, id } }),
    ),
    delete: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    setEnabled: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { ...server, enabled: true, status: 'ready' as const, toolCount: 2 } }),
    ),
    setEnv: vi.fn(() => Promise.resolve({ ok: true as const, value: { ...server, hasEnv: true } })),
    restart: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { ...server, status: 'ready' as const, toolCount: 2 } }),
    ),
    ...over,
  }
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: { mcp, onServers: () => () => undefined },
  })
  return mcp
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Servers panel', () => {
  it('lists a configured server with its command line', async () => {
    bridge()
    render(<Servers />)

    expect(await screen.findByText('Files')).toBeTruthy()
    expect(screen.getByText('npx -y @example/files')).toBeTruthy()
    expect(screen.getByText('Off')).toBeTruthy()
  })

  it('says so when no server is configured yet', async () => {
    bridge({}, [])
    render(<Servers />)
    expect(await screen.findByText('No servers configured')).toBeTruthy()
  })

  it('splits a typed command line into arguments before saving', async () => {
    const mcp = bridge({}, [])
    render(<Servers />)

    fireEvent.click(await screen.findByText('Add server'))
    fireEvent.change(screen.getByPlaceholderText('Files'), { target: { value: 'Notes' } })
    fireEvent.change(screen.getByPlaceholderText('npx'), { target: { value: 'npx' } })
    fireEvent.change(screen.getByPlaceholderText(/server-filesystem/), {
      target: { value: '-y @example/notes --root /opt/notes' },
    })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mcp.create).toHaveBeenCalled()
    })
    const draft = mcp.create.mock.calls[0]?.[0] as McpServerDraft
    expect(draft.args).toEqual(['-y', '@example/notes', '--root', '/opt/notes'])
    expect(draft.cwd).toBeNull()
  })

  /**
   * The panel offers a value box for each name the server takes, and the value
   * only ever travels outward. Nothing sends one back to be displayed.
   */
  it('stores a credential under a name and never shows it again', async () => {
    const mcp = bridge({}, [{ ...server, envNames: ['API_TOKEN'] }])
    render(<Servers />)

    fireEvent.click(await screen.findByText('Files'))
    const secret = screen.getByPlaceholderText('Value for this server')
    fireEvent.change(secret, { target: { value: 'test-token-value' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mcp.setEnv).toHaveBeenCalledWith('server-1', { API_TOKEN: 'test-token-value' })
    })
    expect(secret.getAttribute('type')).toBe('password')
  })

  it('offers no value box for a name that could not be one', async () => {
    bridge({}, [{ ...server, envNames: [] }])
    render(<Servers />)

    fireEvent.click(await screen.findByText('Files'))
    fireEvent.change(screen.getByPlaceholderText('GITHUB_TOKEN API_KEY'), {
      target: { value: '9STARTS-WRONG' },
    })
    expect(screen.queryByPlaceholderText('Value for this server')).toBeNull()
  })

  it('asks main to run a server rather than starting one itself', async () => {
    const mcp = bridge()
    render(<Servers />)

    fireEvent.click(await screen.findByLabelText('Run Files'))
    await waitFor(() => {
      expect(mcp.setEnabled).toHaveBeenCalledWith('server-1', true)
    })
  })

  /**
   * Main answers a declined prompt with the server unchanged. The switch has to
   * follow that answer rather than the click that caused it.
   */
  it('says the server was not started when the prompt is cancelled', async () => {
    bridge({
      setEnabled: vi.fn(() => Promise.resolve({ ok: true as const, value: server })),
    })
    render(<Servers />)

    fireEvent.click(await screen.findByLabelText('Run Files'))
    expect(await screen.findByText('Cancelled. The server was not started.')).toBeTruthy()
  })

  it('explains a failure in words rather than a code', async () => {
    bridge({
      setEnabled: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...server, enabled: true, status: 'failed' as const, errorCode: 'rpc/spawn' },
        }),
      ),
    })
    render(<Servers />)

    fireEvent.click(await screen.findByLabelText('Run Files'))
    expect(await screen.findByText(/could not be started/)).toBeTruthy()
  })

  it('reports what a restart found', async () => {
    bridge({}, [{ ...server, enabled: true, status: 'ready', toolCount: 2 }])
    render(<Servers />)

    fireEvent.click(await screen.findByText('Restart'))
    expect(await screen.findByText('Connected. The server offers 2 tools.')).toBeTruthy()
  })

  it('shows how many tools a running server offers', async () => {
    bridge({}, [{ ...server, enabled: true, status: 'ready', toolCount: 1 }])
    render(<Servers />)
    expect(await screen.findByText('Running · 1 tool')).toBeTruthy()
  })

  it('confirms before deleting a server', async () => {
    const mcp = bridge()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Servers />)

    fireEvent.click(await screen.findByText('Files'))
    fireEvent.click(screen.getByText('Delete'))
    expect(mcp.delete).not.toHaveBeenCalled()
  })

  it('deletes once the confirmation is accepted', async () => {
    const mcp = bridge()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Servers />)

    fireEvent.click(await screen.findByText('Files'))
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => {
      expect(mcp.delete).toHaveBeenCalledWith('server-1')
    })
  })
})
