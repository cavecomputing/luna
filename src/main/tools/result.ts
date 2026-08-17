/**
 * Turns a tool's reply into a ToolStep.
 *
 * Everything arriving here is attacker-controlled: a tool result is data a
 * server chose to send, and it lands in the model's context and in the user's
 * transcript. This module is where that gets bounded and defanged — capped,
 * stripped of control sequences, and reduced to text plus references. It is
 * pure so all of that is testable without a server.
 */

import { MAX_STORED_TOOL_RESULT_CHARS, MAX_TOOL_RESULT_CHARS } from '../../shared/tools.js'
import type { ToolPartRef, ToolStep } from '../../shared/types.js'
import { object } from '../parse.js'

export type ToolOutcome = {
  /** Text as the model should see it, under the in-flight cap. */
  modelText: string
  /** What gets persisted, under the smaller stored cap. */
  step: ToolStep
}

export type CallIdentity = {
  callId: string
  source: string
  name: string
  /** Argument JSON exactly as the model produced it. */
  arguments: string
}

/**
 * Escape and control sequences, built from char codes so this source file
 * contains no literal control bytes of its own.
 */
const ESC = String.fromCharCode(27)
/** ESC [ ... final byte: colours, cursor moves, line erases. */
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g')
/** Remaining escape sequences, including the OSC introducer. */
const ESCAPE = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g')
/**
 * C0 and C1 controls, keeping only tab and newline.
 *
 * Carriage return goes with the rest: on its own it returns the cursor to the
 * start of the line, so text after it overwrites text before it. That is a way
 * to show a person one thing and hand the model another.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the whole job
const CONTROLS = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]', 'g')
/** Directional marks, overrides, and isolates can visually reorder plain text. */
const BIDI = new RegExp('[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]', 'g')

/**
 * Strips escape sequences and control characters, keeping newline and tab.
 *
 * Terminal-flavoured tool output is full of these, and they can repaint a
 * terminal, hide text, or forge structure in a transcript that a person is
 * reading to decide whether the tool did what they wanted.
 */
export function sanitize(input: string): string {
  return input.replace(CSI, '').replace(ESCAPE, '').replace(CONTROLS, '').replace(BIDI, '')
}

function clip(input: string, max: number): { text: string; truncated: boolean } {
  if (input.length <= max) return { text: input, truncated: false }
  return { text: `${input.slice(0, max)}\n[truncated]`, truncated: true }
}

function partRef(item: Record<string, unknown>): ToolPartRef | undefined {
  const type = item.type
  const mediaType = typeof item.mimeType === 'string' ? item.mimeType : undefined

  if (type === 'image' || type === 'audio') {
    return {
      kind: type,
      ...(mediaType === undefined ? {} : { mediaType }),
      // The bytes are deliberately dropped; only their weight is recorded.
      ...(typeof item.data === 'string' ? { size: item.data.length } : {}),
    }
  }
  if (type === 'resource_link') {
    return {
      kind: 'resource_link',
      ...(mediaType === undefined ? {} : { mediaType }),
      ...(typeof item.uri === 'string' ? { uri: sanitize(item.uri).slice(0, 2048) } : {}),
    }
  }
  if (type === 'resource') {
    // An embedded resource carries its own metadata one level down, so the
    // media type is on the resource rather than on the content entry.
    const resource = object(item.resource)
    const uri = typeof resource?.uri === 'string' ? resource.uri : undefined
    const resourceType =
      typeof resource?.mimeType === 'string' ? resource.mimeType : mediaType
    return {
      kind: 'resource',
      ...(resourceType === undefined ? {} : { mediaType: resourceType }),
      ...(uri === undefined ? {} : { uri: sanitize(uri).slice(0, 2048) }),
    }
  }
  return undefined
}

/**
 * Reads a `tools/call` result.
 *
 * `resultType: 'input_required'` is reported as a tool error rather than
 * silently succeeding. Honouring it means driving a form from a schema the
 * server supplies, which is a feature in its own right; telling the model the
 * tool needs input Luna cannot collect lets it route around the tool instead of
 * looping on it.
 */
export function readResult(identity: CallIdentity, result: unknown): ToolOutcome {
  const cell = object(result)
  if (cell === undefined) {
    return failure(identity, 'The tool returned a malformed result.')
  }
  if (cell.resultType === 'input_required') {
    return failure(
      identity,
      'This tool needs interactive input, which Luna cannot provide yet. Try another approach.',
    )
  }

  const texts: string[] = []
  const parts: ToolPartRef[] = []
  if (Array.isArray(cell.content)) {
    for (const entry of cell.content) {
      const item = object(entry)
      if (item === undefined) continue
      if (item.type === 'text' && typeof item.text === 'string') {
        texts.push(sanitize(item.text))
        continue
      }
      const ref = partRef(item)
      if (ref !== undefined) parts.push(ref)
    }
  }

  // A tool that returned only an image still has to say something, or the model
  // sees an empty result and cannot tell success from silence.
  if (texts.length === 0 && parts.length > 0) {
    texts.push(parts.map((part) => `[${part.kind} omitted]`).join('\n'))
  }

  const joined = texts.join('\n')
  const model = clip(joined, MAX_TOOL_RESULT_CHARS)
  const stored = clip(joined, MAX_STORED_TOOL_RESULT_CHARS)

  return {
    modelText: model.text,
    step: {
      callId: identity.callId,
      source: identity.source,
      name: identity.name,
      arguments: identity.arguments,
      text: stored.text,
      ...('structuredContent' in cell ? { structured: cell.structuredContent } : {}),
      ...(parts.length === 0 ? {} : { parts }),
      isError: cell.isError === true,
      truncated: stored.truncated,
    },
  }
}

/**
 * A failure the model is told about so it can correct itself, rather than one
 * that ends the turn. Protocol-level breakage is the caller's problem; this is
 * for everything the model could plausibly retry around.
 */
export function failure(identity: CallIdentity, message: string): ToolOutcome {
  const text = sanitize(message).slice(0, MAX_STORED_TOOL_RESULT_CHARS)
  return {
    modelText: text,
    step: {
      callId: identity.callId,
      source: identity.source,
      name: identity.name,
      arguments: identity.arguments,
      text,
      isError: true,
      truncated: false,
    },
  }
}
