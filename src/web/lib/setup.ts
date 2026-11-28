import type { SetupStep } from '@/model/inbox'

// The setup checklist of a new install, in the order it can be done. The words are the app's;
// which steps are done is the workspace's (src/web/api).

/** The heading of the Inbox's setup card; the Set up your workspace page is named for its start. */
export const setupHeading = 'Set up your workspace so agents can use what you know'

/**
 * Ask first (FR-816): the names come first, since a question and a context item name a metric;
 * then a question nothing answers yet, what you know written down and the same question again,
 * and last your own agent.
 */
export const setupSteps: SetupStep[] = [
  {
    id: 'definitions',
    title: 'Publish your names',
    description:
      'Connect where your metrics are defined, then publish their names. Questions and context name them.',
    action: 'Connect',
  },
  {
    id: 'ask',
    title: 'Ask about a number you know',
    description: 'Pick one you can explain. Nothing is written yet, and the answer will say so.',
    action: 'Ask',
  },
  {
    id: 'fact',
    title: 'Write what you know, and ask again',
    description:
      'Two sentences and where it is written. The same question is then answered from it.',
    action: 'Write context',
  },
  {
    id: 'agent',
    title: 'Ask your own agent',
    description:
      'Paste one prompt into Claude, Cursor or another agent, and ask it the same question.',
    action: 'Connect an agent',
  },
]

/** What a domain is, said where a new install first meets one: where its names go. */
export const domainWords = 'A domain is a part of the business with an owner.'

/** Where the names with no domain go, as the names card offers it (F08). */
export type SetupPlace = { id: string | null; name: string }

/** Where the names waiting go, in the step's words: a new domain is the person's own. */
const placeWords = (place: SetupPlace | null) =>
  !place
    ? 'Once published, questions and context name them.'
    : place.id
      ? `They go under ${place.name}.`
      : `They go under ${place.name}, a new domain you own. ${domainWords}`

/** What the definitions step offers: to publish names waiting, a source's page, or to connect. */
export type DefinitionsOpens = 'names' | 'source' | 'connect'

/**
 * The names step, for an install the server started on its own definitions, such as a model
 * folder: until a read of them has ended it says one is on its way and offers nothing, and it never
 * offers to connect another tool. Names waiting are published from here, whatever source read them.
 * A read that left none waiting, or ended without a good read, opens its source's page, which
 * says what the read found.
 */
export function definitionsStep(
  serverSource: { id: string; state: 'reading' | 'read' | 'failed' } | null,
  waiting: number,
  place: SetupPlace | null = null,
): { description: string; action: string | null; opens: DefinitionsOpens } {
  const step = setupSteps.find((s) => s.id === 'definitions')!
  if (waiting)
    return {
      description: placeWords(place),
      action: `Publish ${waiting === 1 ? '1 name' : `${waiting} names`}`,
      opens: 'names',
    }
  if (!serverSource) return { description: step.description, action: step.action, opens: 'connect' }
  if (serverSource.state === 'failed')
    return {
      description:
        'The definitions this server was started on could not be read. Their page says why.',
      action: 'Open the read',
      opens: 'source',
    }
  if (serverSource.state === 'reading')
    return {
      description:
        'Reading the definitions this server was started on. Their names show here when the read ends.',
      action: null,
      opens: 'source',
    }
  return {
    description:
      'The definitions this server was started on were read, and no names wait. Their page says what the read found.',
    action: 'Open the read',
    opens: 'source',
  }
}

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
