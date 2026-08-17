/**
 * Turning token counts into something readable.
 *
 * Deliberately not a cost: pricing varies per model, changes without notice,
 * and Luna talks to servers that charge nothing at all. Reporting a number of
 * tokens is true everywhere; reporting dollars would be a guess.
 */

import type { TokenUsage } from '../../../shared/types.js'

/** Total tokens a turn consumed, or undefined when nothing was reported. */
export function totalTokens(usage: TokenUsage | undefined): number | undefined {
  if (usage === undefined) return undefined
  const input = usage.inputTokens
  const output = usage.outputTokens
  if (input === undefined && output === undefined) return undefined
  return (input ?? 0) + (output ?? 0)
}

export function formatTokens(count: number): string {
  if (count < 1_000) return String(count)
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/**
 * The hover detail, which breaks the total down.
 *
 * Cached and reasoning tokens are shown only when the provider reported them —
 * many do not, and a zero would read as "none used" rather than "not measured".
 */
export function usageDetail(usage: TokenUsage): string {
  const parts: string[] = []
  if (usage.inputTokens !== undefined) parts.push(`${String(usage.inputTokens)} in`)
  if (usage.outputTokens !== undefined) parts.push(`${String(usage.outputTokens)} out`)
  if (usage.reasoningTokens !== undefined) {
    parts.push(`${String(usage.reasoningTokens)} reasoning`)
  }
  if (usage.cachedTokens !== undefined) parts.push(`${String(usage.cachedTokens)} cached`)
  return parts.join(' · ')
}

/** Sums every assistant turn in a conversation. */
export function conversationTokens(
  messages: readonly { usage?: TokenUsage }[],
): number | undefined {
  let total = 0
  let seen = false
  for (const message of messages) {
    const turn = totalTokens(message.usage)
    if (turn === undefined) continue
    seen = true
    total += turn
  }
  return seen ? total : undefined
}
