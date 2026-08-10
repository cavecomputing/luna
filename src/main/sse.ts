export type SseEvent = {
  event?: string
  data: string
}

/** Incremental parser for the text/event-stream wire format. */
export class SseParser {
  private buffer = ''

  push(chunk: string): SseEvent[] {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, '\n')
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

  finish(): SseEvent[] {
    const block = this.buffer.replace(/\r$/, '')
    this.buffer = ''
    const parsed = parseBlock(block)
    return parsed === undefined ? [] : [parsed]
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
