export type Block =
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] }

/**
 * Minimal placeholder for markdown: paragraphs and `- ` bullet lists only.
 *
 * Real markdown (code blocks, links, emphasis, tables) needs a parser, and a
 * parser is a production dependency — that's a decision to make deliberately,
 * not to smuggle in here. Until then this keeps assistant replies readable
 * without pretending to be a markdown renderer.
 */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let items: string[] = []

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', text: para.join(' ') })
      para = []
    }
  }

  const flushList = (): void => {
    if (items.length > 0) {
      blocks.push({ kind: 'list', items })
      items = []
    }
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()

    if (line === '') {
      flushPara()
      flushList()
      continue
    }

    if (line.startsWith('- ')) {
      flushPara()
      items.push(line.slice(2).trim())
      continue
    }

    flushList()
    para.push(line)
  }

  flushPara()
  flushList()
  return blocks
}
