/**
 * Luna's own tool server.
 *
 * It answers the same methods an external server would and reaches Luna the
 * same way — through the JSON-RPC peer over a loopback transport — so the
 * framing, correlation, timeout, and cancellation paths are all real. A
 * built-in that called a function directly would prove none of them worked.
 *
 * `luna_echo` exists to exercise the loop end to end. It touches nothing.
 */

import { object } from '../parse.js'
import type { Responder } from '../rpc/loopback.js'
import type { ToolDefinition } from '../../shared/tools.js'

export const BUILTIN_SOURCE = 'builtin'
export const BUILTIN_LABEL = 'Luna'

export const builtinTools: readonly ToolDefinition[] = [
  {
    name: 'luna_echo',
    title: 'Echo',
    description:
      'Returns the text it is given, unchanged. Useful only for confirming that ' +
      'tool calling works end to end.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to return.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
]

function result(id: unknown, value: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result: value })
}

function methodError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}

/** A tool failure the model can act on, as distinct from a protocol error. */
function toolError(id: unknown, message: string): string {
  return result(id, { resultType: 'complete', content: [{ type: 'text', text: message }], isError: true })
}

export function builtinResponder(): Responder {
  return (line, reply) => {
    const message = object(JSON.parse(line))
    if (message === undefined) return
    const { id, method } = message
    // Notifications carry no id and expect no answer. `notifications/cancelled`
    // arrives here and is simply ignored: nothing this server does is slow
    // enough to be worth interrupting.
    if (id === undefined || id === null) return

    if (method === 'tools/list') {
      reply(result(id, { resultType: 'complete', tools: builtinTools }))
      return
    }

    if (method !== 'tools/call') {
      reply(methodError(id, -32601, 'unknown method'))
      return
    }

    const params = object(message.params)
    if (params?.name !== 'luna_echo') {
      reply(methodError(id, -32602, 'unknown tool'))
      return
    }

    const args = object(params.arguments)
    if (typeof args?.text !== 'string') {
      reply(toolError(id, 'The `text` argument is required and must be a string.'))
      return
    }

    reply(result(id, {
      resultType: 'complete',
      content: [{ type: 'text', text: args.text }],
      isError: false,
    }))
  }
}
