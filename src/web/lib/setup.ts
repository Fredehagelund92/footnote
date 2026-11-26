import type { SetupStep } from '@/model/inbox'

// The setup checklist of a new install, in the order it can be done. The words are the app's;
// which steps are done is the workspace's (src/web/api).

/** The heading of the Inbox's setup card; the Set up your workspace page is named for its start. */
export const setupHeading = 'Set up your workspace so agents can use what you know'

/** A context item must say which metric it applies to, so its names come before writing. */
export const setupSteps: SetupStep[] = [
  {
    id: 'about',
    title: 'Say what the business is about',
    description:
      'One or two sentences on what the company does. Ask and agents read it as background.',
    action: 'Write',
  },
  {
    id: 'domain',
    title: 'Add your first domain',
    description:
      'A domain is a part of the business with an owner, such as Sales. Context and names belong to one.',
    action: 'Add a domain',
  },
  {
    id: 'definitions',
    title: 'Connect your definitions',
    description:
      'Connect where your metrics are defined, then publish their names. Context applies to those names.',
    action: 'Connect',
  },
  {
    id: 'fact',
    title: 'Write your first context item',
    description: 'Two sentences and a source. In a domain you own, it is published at once.',
    action: 'Write context',
  },
  {
    id: 'ask',
    title: 'Ask a question about it',
    description: 'See the answer an agent gets, from what you just wrote.',
    action: 'Ask',
  },
  {
    id: 'agent',
    title: 'Connect your agent',
    description: 'Paste one prompt into Claude, Cursor or another agent, and approve it once.',
    action: 'Copy the prompt',
  },
]

/** What the definitions step offers: to publish names waiting, a source's page, or to connect. */
export type DefinitionsOpens = 'names' | 'source' | 'connect'

/**
 * The definitions step, for an install the server started on its own definitions, such as a model
 * folder: until a read of them has ended it says one is on its way and offers nothing, and it never
 * offers to connect another tool. Names waiting are published from here, whatever source read them.
 * A read that left none waiting, or ended without a good read, opens its source's page, which
 * says what the read found.
 */
export function definitionsStep(
  serverSource: { id: string; state: 'reading' | 'read' | 'failed' } | null,
  waiting: number,
): { description: string; action: string | null; opens: DefinitionsOpens } {
  const step = setupSteps.find((s) => s.id === 'definitions')!
  if (waiting)
    return {
      description: step.description,
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
