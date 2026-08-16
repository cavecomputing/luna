/**
 * Asking a person before a tool runs.
 *
 * The prompt is a native message box driven from main, not a renderer dialog.
 * Three reasons, in order of weight:
 *
 * 1. A renderer is untrusted by construction — bus.ts checks the sender on
 *    every channel precisely because a compromised page can send anything. A
 *    consent decision arriving over IPC is a decision a compromised page can
 *    forge. This is the same reasoning that put delete-all and clear-attachments
 *    on `ask()`.
 * 2. Tool names, descriptions, and arguments are attacker-controlled text. A
 *    native box takes plain strings; the renderer would put them through the
 *    markdown pipeline.
 * 3. Events are one-way with no correlation id, so asking the renderer a
 *    question would mean inventing a reply protocol — request ids, timeouts,
 *    window-closed handling, duplicate and forged reply guards — in the same
 *    change as the tool loop.
 *
 * Deny is both the default button and the cancel button. Elsewhere in Luna the
 * destructive verb is the affirmative answer; here the safe answer *is* cancel,
 * and deny-by-default requires them to be the same index.
 */

import type { ToolAnnotations, ToolDefinition } from '../shared/tools.js'
import { ask } from './dialogs.js'

export type Approval = 'deny' | 'once' | 'always'

export type ApprovalRequest = {
  sourceLabel: string
  definition: ToolDefinition
  /** Argument JSON as the model produced it. */
  arguments: string
}

export type ConsentDeps = {
  ask: (options: {
    type: 'warning'
    buttons: string[]
    defaultId: number
    cancelId: number
    noLink: true
    message: string
    detail: string
  }) => Promise<number>
}

const deps: ConsentDeps = { ask }

/** Only one native box at a time, however many turns are in flight. */
let queue: Promise<unknown> = Promise.resolve()

const MAX_DETAIL_ARGS = 500
const MAX_DETAIL_DESCRIPTION = 300

/** Strips anything that could forge structure in a plain-text dialog. */
function flatten(input: string, max: number): string {
  const collapsed = input.replace(/\s+/g, ' ').trim()
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`
}

/**
 * Renders the tool's own hints.
 *
 * These are shown because they are the most useful thing a person has to go on,
 * and attributed to the tool because the protocol requires treating them as
 * untrusted. Nothing in Luna branches on them.
 */
export function hintLine(annotations: ToolAnnotations | undefined): string {
  if (annotations === undefined) return ''
  const claims: string[] = []
  if (annotations.readOnlyHint === true) claims.push('only reads')
  if (annotations.destructiveHint === true) claims.push('may delete or overwrite')
  if (annotations.openWorldHint === true) claims.push('reaches external services')
  if (claims.length === 0) return ''
  return `The tool reports that it ${claims.join(', ')}.`
}

export function detailFor(request: ApprovalRequest): string {
  const description = flatten(request.definition.description, MAX_DETAIL_DESCRIPTION)
  const args = flatten(request.arguments, MAX_DETAIL_ARGS)
  return [
    `From: ${request.sourceLabel}`,
    description === '' ? '' : `Description provided by the tool: ${description}`,
    hintLine(request.definition.annotations),
    '',
    `Arguments: ${args === '' ? '(none)' : args}`,
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n')
}

/**
 * Asks, once the queue reaches this request.
 *
 * The wait races the turn's abort signal. Electron cannot dismiss a message box
 * programmatically, so on abort this stops waiting and answers deny while the
 * box stays on screen; a later click is discarded. Without that race, stopAll()
 * and the privacy delete would both block behind an unanswered modal.
 */
export async function requestApproval(
  request: ApprovalRequest,
  signal: AbortSignal,
  d: ConsentDeps = deps,
): Promise<Approval> {
  if (signal.aborted) return 'deny'

  const turn = queue.then(async () => {
    if (signal.aborted) return 'deny' as const
    const answer = await d.ask({
      type: 'warning',
      buttons: ['Deny', 'Allow once', 'Always allow'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `Allow ${request.definition.title ?? request.definition.name} to run?`,
      detail: detailFor(request),
    })
    if (answer === 2) return 'always' as const
    return answer === 1 ? ('once' as const) : ('deny' as const)
  })

  // The queue advances on the box being answered, not on the caller giving up,
  // so an abandoned prompt cannot let a second one open behind it.
  queue = turn.catch(() => undefined)

  return await new Promise<Approval>((resolve) => {
    let settled = false
    const finish = (value: Approval): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    function onAbort(): void {
      finish('deny')
    }
    signal.addEventListener('abort', onAbort, { once: true })
    turn.then(finish, () => {
      finish('deny')
    })
  })
}

/** Test seam: the module-level queue outlives a single call by design. */
export function resetQueue(): void {
  queue = Promise.resolve()
}
