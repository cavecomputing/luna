export type ThinkingText = {
  reasoning: string
  text: string
  /** True after an opening tag and before its closing tag has arrived. */
  thinking: boolean
}

const OPEN = '<think>'
const CLOSE = '</think>'
const TAG = /<\/?think>/gi

/**
 * Length of the longest suffix of `source` that is an incomplete `token`.
 *
 * Only the last few characters can be one, so this reads them directly rather
 * than lowercasing the remaining text. That matters: this runs on the whole
 * accumulated reply once per streamed delta.
 */
function partialTokenLength(source: string, token: string, from: number): number {
  const maximum = Math.min(source.length - from, token.length - 1)
  for (let length = maximum; length > 0; length -= 1) {
    if (source.slice(source.length - length).toLowerCase() === token.slice(0, length)) {
      return length
    }
  }
  return 0
}

/**
 * Separates the explicit reasoning convention used by some local models.
 * Re-parsing accumulated text makes tags split across any SSE boundary safe.
 *
 * One case-insensitive pass, because the caller runs this on every delta and
 * the string it passes grows with the reply. Lowercasing the source instead
 * would copy the entire accumulated response several times per delta.
 */
export function parseThinkingTags(source: string, complete = false): ThinkingText {
  let reasoning = ''
  let text = ''
  let cursor = 0
  let thinking = false

  TAG.lastIndex = 0
  for (let match = TAG.exec(source); match !== null; match = TAG.exec(source)) {
    // Only the tag the current state waits for ends a section. The other one is
    // literal, which is what a model quoting these tags in its answer produces.
    const closing = match[0].charAt(1) === '/'
    if (closing !== thinking) continue
    const content = source.slice(cursor, match.index)
    if (thinking) reasoning += content
    else text += content
    cursor = match.index + match[0].length
    thinking = !thinking
  }

  const partial = partialTokenLength(source, thinking ? CLOSE : OPEN, cursor)
  const end = partial === 0 || complete ? source.length : source.length - partial
  const tail = source.slice(cursor, end)
  if (thinking) reasoning += tail
  else text += tail

  return { reasoning, text, thinking }
}
