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
