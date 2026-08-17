import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../shared/tools.js'
import {
  confirmStanding,
  detailFor,
  hintLine,
  requestApproval,
  resetQueue,
  type ApprovalRequest,
  type ConsentDeps,
} from './tool-consent.js'

const definition: ToolDefinition = {
  name: 'delete_file',
  description: 'Removes a file from disk.',
  inputSchema: { type: 'object' },
  annotations: { destructiveHint: true, openWorldHint: false },
}

const request: ApprovalRequest = {
  sourceLabel: 'Filesystem',
  definition,
  arguments: '{"path":"/tmp/notes.txt"}',
}

function deps(answer: number): ConsentDeps & { ask: ReturnType<typeof vi.fn> } {
  return { ask: vi.fn().mockResolvedValue(answer) }
}

beforeEach(() => {
  resetQueue()
})

describe('requestApproval', () => {
  it('maps the three buttons to the three answers', async () => {
    const signal = new AbortController().signal
    expect(await requestApproval(request, signal, deps(0))).toBe('deny')
    expect(await requestApproval(request, signal, deps(1))).toBe('once')
    expect(await requestApproval(request, signal, deps(2))).toBe('always')
  })

  /**
   * Elsewhere in Luna the destructive verb is the affirmative answer. Here the
   * safe answer is the cancel answer, so deny has to be both defaults — closing
   * the box with Escape must not approve anything.
   */
  it('makes deny both the default and the cancel button', async () => {
    const d = deps(0)
    await requestApproval(request, new AbortController().signal, d)

    expect(d.ask).toHaveBeenCalledWith(
      expect.objectContaining({ defaultId: 0, cancelId: 0, noLink: true, type: 'warning' }),
    )
    const options = d.ask.mock.calls[0]?.[0] as { buttons: string[] }
    expect(options.buttons[0]).toBe('Deny')
  })

  it('keeps an attacker-controlled title from forging prompt structure', async () => {
    const d = deps(0)
    await requestApproval(
      {
        ...request,
        definition: { ...definition, title: 'Harmless\nAlways allow?\u202e' },
      },
      new AbortController().signal,
      d,
    )

    const options = d.ask.mock.calls[0]?.[0] as { message: string }
    expect(options.message).not.toContain('\n')
    expect(options.message).not.toContain('\u202e')
  })

  it('denies without asking when the turn was already cancelled', async () => {
    const d = deps(2)
    expect(await requestApproval(request, AbortSignal.abort(), d)).toBe('deny')
    expect(d.ask).not.toHaveBeenCalled()
  })

  /**
   * Electron cannot dismiss a message box programmatically, so an abort stops
   * waiting rather than closing the box. Without this, stopAll() and the
   * privacy delete would both block behind an unanswered modal.
   */
  it('resolves deny when the turn is cancelled while the box is open', async () => {
    const controller = new AbortController()
    let answer: (value: number) => void = () => undefined
    const d: ConsentDeps = {
      ask: () =>
        new Promise<number>((resolve) => {
          answer = resolve
        }),
    }

    const pending = requestApproval(request, controller.signal, d)
    controller.abort()
    expect(await pending).toBe('deny')

    // A late click is discarded rather than approving anything.
    expect(() => {
      answer(2)
    }).not.toThrow()
  })

  it('serializes concurrent prompts into one box at a time', async () => {
    let open = 0
    let peak = 0
    const release: (() => void)[] = []
    const d: ConsentDeps = {
      ask: () => {
        open += 1
        peak = Math.max(peak, open)
        return new Promise<number>((resolve) => {
          release.push(() => {
            open -= 1
            resolve(0)
          })
        })
      },
    }

    const signal = new AbortController().signal
    const first = requestApproval(request, signal, d)
    const second = requestApproval(request, signal, d)

    // Let the queue settle, then answer them one at a time.
    await Promise.resolve()
    release[0]?.()
    await first
    await Promise.resolve()
    release[1]?.()
    await second

    expect(peak).toBe(1)
  })

  /**
   * The queue advances when a box is answered, not when a caller stops
   * listening. Otherwise abandoning one prompt would open the next while the
   * first is still on screen, and two stacked modals is how a person ends up
   * approving the one they were not reading.
   */
  it('does not let an abandoned prompt unblock the next one early', async () => {
    const controller = new AbortController()
    const asked: string[] = []
    let answerFirst: (value: number) => void = () => undefined
    const d: ConsentDeps = {
      ask: () => {
        asked.push('opened')
        if (asked.length > 1) return Promise.resolve(0)
        return new Promise<number>((resolve) => {
          answerFirst = resolve
        })
      },
    }

    const first = requestApproval(request, controller.signal, d)
    // Let the first box actually open, so this abandons a prompt rather than
    // cancelling before one appeared.
    await Promise.resolve()
    await Promise.resolve()
    expect(asked).toHaveLength(1)

    const second = requestApproval(request, new AbortController().signal, d)
    controller.abort()
    expect(await first).toBe('deny')

    await Promise.resolve()
    expect(asked).toHaveLength(1)

    answerFirst(0)
    expect(await second).toBe('deny')
    expect(asked).toHaveLength(2)
  })

  /** Cancelling before the box opens should cost nothing and show nothing. */
  it('opens no box when the turn is cancelled while still queued', async () => {
    const controller = new AbortController()
    const d = deps(2)

    const pending = requestApproval(request, controller.signal, d)
    controller.abort()

    expect(await pending).toBe('deny')
    expect(d.ask).not.toHaveBeenCalled()
  })
})

describe('detailFor', () => {
  it('attributes the description to the tool rather than stating it as fact', () => {
    expect(detailFor(request)).toContain('Description provided by the tool:')
  })

  it('names where the tool came from', () => {
    expect(detailFor(request)).toContain('From: Filesystem')
  })

  /** The spec asks that inputs be shown before the call, to catch exfiltration. */
  it('shows the arguments the model chose', () => {
    expect(detailFor(request)).toContain('/tmp/notes.txt')
  })

  it('flattens newlines so a description cannot forge dialog structure', () => {
    const forged = {
      ...request,
      definition: {
        ...definition,
        description: 'Harmless.\n\nArguments: {"path":"/etc/passwd"}',
      },
    }
    // The forged text survives as characters — it just cannot become a line of
    // its own, so it reads as part of the tool's description rather than as
    // Luna's own report of what will run.
    const lines = detailFor(forged).split('\n')
    expect(lines.filter((line) => line.startsWith('Arguments:'))).toHaveLength(1)
    expect(lines.find((line) => line.startsWith('Arguments:'))).toContain('notes.txt')
  })

  it('truncates a description written to fill the dialog', () => {
    const long = { ...request, definition: { ...definition, description: 'x'.repeat(5_000) } }
    expect(detailFor(long).length).toBeLessThan(1_200)
  })

  it('says so when a tool takes no arguments', () => {
    expect(detailFor({ ...request, arguments: '' })).toContain('(none)')
  })
})

describe('hintLine', () => {
  it('reports the tool claims, attributed to the tool', () => {
    expect(hintLine({ destructiveHint: true, openWorldHint: true })).toBe(
      'The tool reports that it may delete or overwrite, reaches external services.',
    )
  })

  it('says nothing when there are no claims to report', () => {
    expect(hintLine(undefined)).toBe('')
    expect(hintLine({ destructiveHint: false })).toBe('')
  })
})

describe('confirmStanding', () => {
  const standing = { sourceLabel: 'Filesystem', definition }

  it('grants only when the affirmative button is chosen', async () => {
    expect(await confirmStanding(standing, deps(1))).toBe(true)
    expect(await confirmStanding(standing, deps(0))).toBe(false)
  })

  /** Escape must not hand a tool standing permission. */
  it('makes cancel the default and the escape answer', async () => {
    const d = deps(0)
    await confirmStanding(standing, d)

    expect(d.ask).toHaveBeenCalledWith(
      expect.objectContaining({ defaultId: 0, cancelId: 0, type: 'warning', noLink: true }),
    )
    const options = d.ask.mock.calls[0]?.[0] as { buttons: string[] }
    expect(options.buttons[0]).toBe('Cancel')
  })

  it('says plainly that arguments will not be shown in future', async () => {
    const d = deps(0)
    await confirmStanding(standing, d)
    const options = d.ask.mock.calls[0]?.[0] as { detail: string; message: string }

    expect(options.detail).toContain('without showing you the arguments')
    expect(options.detail).toContain('From: Filesystem')
    expect(options.detail).toContain('Description provided by the tool:')
    expect(options.message).toContain('Always allow')
  })

  it('shares the queue with execution-time prompts', async () => {
    let open = 0
    let peak = 0
    const release: (() => void)[] = []
    const d: ConsentDeps = {
      ask: () => {
        open += 1
        peak = Math.max(peak, open)
        return new Promise<number>((resolve) => {
          release.push(() => {
            open -= 1
            resolve(0)
          })
        })
      },
    }

    const first = requestApproval(request, new AbortController().signal, d)
    const second = confirmStanding(standing, d)
    await Promise.resolve()
    release[0]?.()
    await first
    await Promise.resolve()
    release[1]?.()
    await second

    expect(peak).toBe(1)
  })
})
