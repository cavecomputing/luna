/**
 * A minimal stdio MCP server, for the end-to-end test to connect to.
 *
 * Modern era: it answers `server/discover` immediately, so nothing here waits
 * out the legacy probe. Two tools, one of which reports the environment
 * variable it was launched with — that is how the test sees a credential reach
 * a process without the value ever passing through the renderer.
 */

const MODERN = '2026-07-28'

const tools = [
  {
    name: 'reverse_text',
    title: 'Reverse text',
    description: 'Returns the given text, reversed.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'report_token',
    title: 'Report token',
    description: 'Reports whether this server was given a token.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
]

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

function answer(message) {
  if (message.method === 'server/discover') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        resultType: 'complete',
        supportedVersions: [MODERN],
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'luna-e2e-server', version: '1.0.0' },
        },
      },
    })
    return
  }

  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools } })
    return
  }

  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'reverse_text') {
      const text = String(args.text ?? '')
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: [...text].reverse().join('') }] },
      })
      return
    }
    if (name === 'report_token') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            { type: 'text', text: process.env.E2E_TOKEN === undefined ? 'absent' : 'present' },
          ],
        },
      })
      return
    }
  }

  send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method' } })
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let cut = buffer.indexOf('\n')
  while (cut !== -1) {
    const line = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (line !== '') {
      try {
        const message = JSON.parse(line)
        if (message.id !== undefined) answer(message)
      } catch {
        // A line we cannot read is not a reason to stop reading.
      }
    }
    cut = buffer.indexOf('\n')
  }
})
