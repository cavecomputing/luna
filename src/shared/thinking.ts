export type ThinkingText = {
  reasoning: string
  text: string
  /** True after an opening tag and before its closing tag has arrived. */
  thinking: boolean
}

const OPEN = '<think>'
const CLOSE = '</think>'

function findToken(source: string, token: string, from: number): number {
  return source.toLowerCase().indexOf(token, from)
}

function partialTokenLength(source: string, token: string, from: number): number {
  const remaining = source.slice(from).toLowerCase()
  const maximum = Math.min(remaining.length, token.length - 1)
  for (let length = maximum; length > 0; length -= 1) {
    if (remaining.endsWith(token.slice(0, length))) return length
  }
  return 0
}

/**
 * Separates the explicit reasoning convention used by some local models.
 * Re-parsing accumulated text makes tags split across any SSE boundary safe.
 */
export function parseThinkingTags(source: string, complete = false): ThinkingText {
  let reasoning = ''
  let text = ''
  let cursor = 0
  let thinking = false

  while (cursor < source.length) {
    const token = thinking ? CLOSE : OPEN
    const found = findToken(source, token, cursor)
    if (found >= 0) {
      const content = source.slice(cursor, found)
      if (thinking) reasoning += content
      else text += content
      cursor = found + token.length
      thinking = !thinking
      continue
    }

    const partial = partialTokenLength(source, token, cursor)
    const end = partial === 0 || complete ? source.length : source.length - partial
    const content = source.slice(cursor, end)
    if (thinking) reasoning += content
    else text += content
    break
  }

  return { reasoning, text, thinking }
}
