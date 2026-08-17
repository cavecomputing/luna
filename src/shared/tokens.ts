/**
 * Estimating how much of a model's context a conversation will use, and
 * deciding what to leave out when it will not fit.
 *
 * The estimate is deliberately crude. A real tokenizer means shipping one per
 * model family, and Luna talks to arbitrary OpenAI-compatible servers whose
 * tokenizer it cannot know. An approximation that is always available beats an
 * exact number that is only right for one provider — so everything here is
 * sized to fail safe, and the budget keeps headroom for being wrong.
 */

/** Assumed context window when a model slot does not name one. */
export const DEFAULT_CONTEXT_TOKENS = 128_000

/**
 * Share of the window history may occupy.
 *
 * The rest is headroom for the reply, for tool results this turn, and for the
 * estimate itself being low.
 */
export const HISTORY_BUDGET_RATIO = 0.6

/** Rough per-message overhead for role markers and framing. */
const MESSAGE_OVERHEAD = 4

/**
 * Characters per token for mostly-Latin text.
 *
 * CJK runs closer to one token per character, so they are counted separately
 * rather than averaged — averaging would badly undercount a Chinese or Japanese
 * conversation, which is the case where being wrong actually loses messages.
 */
const CHARS_PER_TOKEN = 4

/**
 * Scripts that run near one token per character.
 *
 * Written as escapes so the ranges are readable and the file stays ASCII:
 * kana, CJK ideographs and extension A, compatibility ideographs, halfwidth
 * katakana, and Hangul syllables.
 */
const CJK = new RegExp(
  '[\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF' +
    '\\uF900-\\uFAFF\\uFF66-\\uFF9F\\uAC00-\\uD7AF]',
  'gu',
)

export function estimateTokens(text: string): number {
  if (text === '') return 0
  const wide = text.match(CJK)?.length ?? 0
  const rest = text.length - wide
  return wide + Math.ceil(rest / CHARS_PER_TOKEN)
}

/** What history planning needs to know about one message. */
export type Sized = {
  role: 'user' | 'assistant'
  /** Estimated tokens for everything this message contributes. */
  tokens: number
}

export type HistoryPlan = {
  /** Index of the first message to send. Everything before it is dropped. */
  from: number
  /** True when anything was left out, so the user can be told. */
  trimmed: boolean
}

/**
 * Chooses how much history fits.
 *
 * Oldest first, because recent turns are what the current question depends on.
 * Two things are never dropped: the trailing turn, which is what the user just
 * asked, and half of a pair — dropping an assistant row while keeping the user
 * row that prompted it produces a transcript that reads as if the model ignored
 * a question.
 *
 * The scan walks backwards accumulating cost, then moves the cut forward to the
 * next user message, so history always resumes at the start of a turn.
 */
export function planHistory(messages: readonly Sized[], budget: number): HistoryPlan {
  if (messages.length === 0) return { from: 0, trimmed: false }

  let used = 0
  let from = messages.length
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message === undefined) continue
    const cost = message.tokens + MESSAGE_OVERHEAD
    // The last message is kept whatever it costs; sending nothing at all would
    // be a worse failure than sending something oversized.
    if (used + cost > budget && i < messages.length - 1) break
    used += cost
    from = i
  }

  // Resume at a user message so the model never opens on a dangling reply.
  let start = from
  while (start < messages.length && messages[start]?.role !== 'user') start += 1
  if (start >= messages.length) {
    // Nothing at or after the cut is a user message, which happens when the
    // history ends on a reply. Walk back to the message that prompted it
    // rather than opening on the reply itself, even though that costs more.
    start = from
    while (start > 0 && messages[start]?.role !== 'user') start -= 1
  }

  return { from: start, trimmed: start > 0 }
}

/** Tokens history may occupy for a given context window. */
export function historyBudget(contextTokens: number): number {
  return Math.max(1, Math.floor(contextTokens * HISTORY_BUDGET_RATIO))
}
