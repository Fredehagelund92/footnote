// The Inbox's Next card, in a module of its own: only the card reads it, and it is lazy loaded.

/** How many published context items end the Next card (FR-816, the owner's call 3). */
export const NEXT_UNTIL = 5

/** The most metrics the Next card names: the rest wait in Definitions. */
const NEXT_METRICS = 3

/** One thing the Next card offers, in the order it shows them. */
export type NextStep =
  { kind: 'metric'; metric: string; asked: boolean } | { kind: 'people' } | { kind: 'documents' }

/** Whether a Not found card's scope, such as "Churn Rate, October 2026", is about `metric`. */
const about = (scope: string, metric: string) =>
  scope === metric || (scope.startsWith(metric) && /^[\s,]/.test(scope.slice(metric.length)))

/**
 * What the Inbox offers once the setup checklist is done, until `NEXT_UNTIL` context items are
 * published: the metrics nothing is written about, those agents asked about first (the scopes of
 * the Not found cards), then, for an admin, a colleague who knows and the documents your team
 * writes in. Null once enough is published, or when nothing is left to offer.
 */
export function nextSteps(input: {
  published: number
  /** The metrics with no context, in Definitions' order. */
  uncovered: readonly string[]
  /** What the Not found cards are about. */
  asked: readonly string[]
  admin: boolean
}): NextStep[] | null {
  if (input.published >= NEXT_UNTIL) return null
  // A scope is about the longest name it starts with: Churn Rate in Norway is not about Churn.
  const longest = [...input.uncovered].sort((a, b) => b.length - a.length)
  const askedAbout = new Set(
    input.asked.flatMap((scope) => longest.find((metric) => about(scope, metric)) ?? []),
  )
  const asked = (metric: string) => askedAbout.has(metric)
  const metrics = [...input.uncovered]
    .sort((a, b) => Number(asked(b)) - Number(asked(a)))
    .slice(0, NEXT_METRICS)
    .map((metric): NextStep => ({ kind: 'metric', metric, asked: asked(metric) }))
  const steps: NextStep[] = [
    ...metrics,
    ...(input.admin ? [{ kind: 'people' } as const, { kind: 'documents' } as const] : []),
  ]
  return steps.length ? steps : null
}

/** The Next card's heading and the line under it, by how many items are published. */
export const nextWords = (published: number) => ({
  heading: 'Next: write down what agents will ask about',
  description: `Every item you publish answers the agents that ask about it. This card goes once ${NEXT_UNTIL} are published.`,
  count: `${Math.min(published, NEXT_UNTIL)} of ${NEXT_UNTIL} published`,
})

/** What one of the Next card's rows says, and its button. */
export function nextStepWords(step: NextStep): {
  title: string
  description: string
  action: string
} {
  if (step.kind === 'metric')
    return {
      title: `Write about ${step.metric}`,
      description: step.asked
        ? 'Agents asked about it and found nothing written down.'
        : 'Nothing is written about it yet, so agents who ask get Not found.',
      action: 'Write context',
    }
  if (step.kind === 'people')
    return {
      title: 'Bring in the person who knows',
      description:
        "Most of what agents need is in a colleague's head. Invite them, or send them the link on a Not found card.",
      action: 'Invite people',
    }
  return {
    title: 'Connect your documents',
    description:
      'Where your team already writes things down, such as Google Drive or Markdown in Git. Each document waits as a suggestion.',
    action: 'Connect',
  }
}
