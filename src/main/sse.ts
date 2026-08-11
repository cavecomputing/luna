export type SseEvent = {
  event?: string
  data: string
}

/** Incremental parser for the text/event-stream wire format. */
export class SseParser {
  private buffer = ''
  private trailingCr = false

  push(chunk: string): SseEvent[] {
    this.append(chunk)
    return this.takeEvents()
  }

  finish(): SseEvent[] {
    if (this.trailingCr) {
      this.buffer += '\n'
      this.trailingCr = false
    }
    const events = this.takeEvents()
    const parsed = parseBlock(this.buffer)
    this.buffer = ''
    if (parsed !== undefined) events.push(parsed)
    return events
  }

  private append(chunk: string): void {
    if (chunk === '') return
    let offset = 0
    if (this.trailingCr) {
      this.buffer += '\n'
      this.trailingCr = false
      if (chunk.startsWith('\n')) offset = 1
    }

    for (let i = offset; i < chunk.length; i += 1) {
      const char = chunk.charAt(i)
      if (char !== '\r') {
        this.buffer += char
        continue
      }
      if (i + 1 >= chunk.length) {
        this.trailingCr = true
      } else {
        this.buffer += '\n'
        if (chunk.charAt(i + 1) === '\n') i += 1
      }
    }
  }

  private takeEvents(): SseEvent[] {
    const events: SseEvent[] = []
    let boundary = this.buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const parsed = parseBlock(block)
      if (parsed !== undefined) events.push(parsed)
      boundary = this.buffer.indexOf('\n\n')
    }
    return events
  }
}

function parseBlock(block: string): SseEvent | undefined {
  let event: string | undefined
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }
  if (data.length === 0) return undefined
  return { ...(event === undefined ? {} : { event }), data: data.join('\n') }
}
