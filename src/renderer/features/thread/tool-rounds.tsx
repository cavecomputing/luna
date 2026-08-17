import type { ToolRound, ToolStep } from '../../../shared/types.js'
import styles from './tool-rounds.module.css'

type Props = {
  rounds: ToolRound[]
}

/**
 * Formats argument JSON for display, falling back to the raw text.
 *
 * The model writes these, so they are not guaranteed to parse. Showing the raw
 * string when they don't is more honest than hiding that it was malformed.
 */
function readable(args: string): string {
  if (args.trim() === '') return '{}'
  try {
    return JSON.stringify(JSON.parse(args), null, 1)
  } catch {
    return args
  }
}

function partLabel(step: ToolStep): string | undefined {
  if (step.parts === undefined || step.parts.length === 0) return undefined
  return step.parts
    .map((part) => (part.mediaType === undefined ? part.kind : `${part.kind} (${part.mediaType})`))
    .join(', ')
}

/**
 * Tool activity, shown as escaped text and nothing else.
 *
 * Everything here came from outside Luna, so none of it goes through Markdown
 * or the HTML preview. A tool result is data the model was given, not content
 * the user asked to render.
 */
export function ToolRounds({ rounds }: Props): React.JSX.Element | null {
  const steps = rounds.flatMap((round) => round.steps)
  if (steps.length === 0) return null
  const failed = steps.filter((step) => step.isError).length

  return (
    <details className={styles.rounds}>
      <summary>
        {steps.length === 1 ? '1 tool call' : `${String(steps.length)} tool calls`}
        {failed > 0 && <span className={styles.failed}> · {String(failed)} failed</span>}
      </summary>
      <ol className={styles.list}>
        {rounds.flatMap((round, roundIndex) =>
          round.steps.map((step, stepIndex) => {
            const parts = partLabel(step)
            return (
              <li
                className={styles.step}
                key={`${String(roundIndex)}:${String(stepIndex)}:${step.callId}`}
              >
                <div className={styles.head}>
                  <span className={styles.name}>{step.name}</span>
                  <span className={styles.source}>{step.source}</span>
                  {step.isError && <span className={styles.error}>failed</span>}
                </div>
                <pre className={styles.code}>{readable(step.arguments)}</pre>
                <pre className={styles.code}>{step.text}</pre>
                {step.truncated && <span className={styles.note}>Result truncated.</span>}
                {parts !== undefined && (
                  <span className={styles.note}>Also returned: {parts}</span>
                )}
              </li>
            )
          }),
        )}
      </ol>
    </details>
  )
}
