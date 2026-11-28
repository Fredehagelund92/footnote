import {
  earlierTurn,
  WRITING_HELP_EARLIER_TURNS,
  writingHelpNoModel,
  type HelpFieldName,
  type HelpStop,
} from '@domain/writing-help'
import { fieldList, HELP_NAME, sessionFields, type SessionField } from './draft-session'

/*
  Writing help in the editor's dock (Route 3): the person says what happened or what to change,
  and it changes the fields of their draft, which they see land beside the chat, marked, with Undo.
  It replies as "I"; the strip and the marks in the draft say "Writing help". It writes one draft
  and nothing else: it cannot send it, and it answers no question about the business, which is
  Ask's. The chat is kept in the browser's memory for the visit and nowhere else.
*/

export { HELP_NAME }

/** The editor's field each of the service's is part of: the text is the summary and the detail. */
const fieldOf: Record<HelpFieldName, SessionField> = {
  title: 'title',
  summary: 'text',
  text: 'text',
  kind: 'kind',
  scope: 'where',
  window: 'when',
  evidence: 'source',
  not_to_conclude: 'dontConclude',
}

/** The service's fields as the editor's, each once, in the order given. */
export const editorFields = (names: readonly HelpFieldName[]): SessionField[] => [
  ...new Set(names.map((name) => fieldOf[name])),
]

/** The first box of Write context, by who fills the draft in from what the person gives it. */
export type FrontDoor = {
  /** Writing help writes the draft, or the fields fill in by rule, as Draft from text does. */
  by: 'help' | 'rule'
  /** The line under the question: what to give it, and what comes of it. */
  how: string
  button: string
  /** What the button does with the words, said under it: where they go, or that no model reads them. */
  note: string
  /**
   * With no writing help: how it would get here, a line each. A member is told who can turn it on;
   * an admin is led to its switch in Settings, and, with no model, first to how one is connected.
   */
  more: { text: string; link?: { to: 'switch' | 'model-guide'; label: string } }[]
}

/**
 * The first box as it stands for this person. Writing help writes the draft where it is there to
 * ask (`help`: an admin turned it on and a model is connected). Anywhere else the fields fill in by
 * rule, which no install is without, and lines say what is missing: its switch, which an admin turns on, and
 * with no model (`model`), a model, which only an admin can do something about.
 */
export function frontDoor({
  help,
  model,
  admin,
}: {
  help: boolean
  model: boolean
  admin: boolean
}): FrontDoor {
  if (help)
    return {
      by: 'help',
      how: `Paste a message, a link, or just say what happened. ${HELP_NAME} writes the draft, and you check each field.`,
      button: 'Write the draft',
      note: 'What you write here goes to the AI model set for Ask. Only you see the draft until you send or publish it.',
      more: [],
    }
  return {
    by: 'rule',
    how: 'Paste a message, a link, or just say what happened. The fields fill in from it, and you check each one.',
    button: 'Fill it in',
    note: 'Filled in by rule, with no AI model.',
    more: admin
      ? [
          ...(model
            ? []
            : [
                {
                  text: writingHelpNoModel,
                  link: { to: 'model-guide' as const, label: 'How to connect a model' },
                },
              ]),
          {
            text: 'With writing help on, people can talk a draft through.',
            link: { to: 'switch' as const, label: 'Turn it on in Settings' },
          },
        ]
      : [
          {
            text: 'Ask an admin to turn on writing help in Settings, and you can talk the draft through.',
          },
        ],
  }
}

/** What a turn is doing while it runs. */
export type HelpProgress =
  | { doing: 'reading'; links: number }
  | { doing: 'looking' }
  | { doing: 'writing'; field?: SessionField }

/** A turn as it ended, by the editor's fields. */
export type HelpReply = {
  /** What writing help says, in its own words; empty when it stopped before it said anything. */
  reply: string
  changed: SessionField[]
  /** The fields the person changed while it worked: they keep the person's words. */
  kept: SessionField[]
  /** The fields the checks refused, each with why. */
  refused: { field: SessionField; why: string }[]
  /** One question back, with up to two answers to tap. */
  question: { text: string; answers: string[] } | null
  links: { read: number; problem: string | null }
  /** Why it ended before it answered; null when it answered. */
  stopped: HelpStop | null
  /** A spending limit that stopped it, in its own sentence. */
  limit: string | null
}

/** What a turn tells the page as it runs. */
export type HelpEvent =
  | { type: 'progress'; progress: HelpProgress }
  | { type: 'written'; changed: SessionField[] }
  | { type: 'words'; text: string }

/** A turn as the binding runs it: its `signal` stops it, and `onEvent` hears it as it goes. */
export type HelpLive = { signal?: AbortSignal; onEvent?: (event: HelpEvent) => void }

/** One turn in the dock: what the person said, and what came of it. */
export type HelpTurn = {
  id: string
  said: string
  /**
   * `asking` while it runs, `done` once it ended (answered, or stopped by a limit), `stopped` when
   * the person pressed Stop, `failed` when it could not be asked at all.
   */
  state: 'asking' | 'done' | 'stopped' | 'failed'
  progress: HelpProgress | null
  /** The reply's words so far, while it writes them. */
  words: string
  /** The fields it has changed so far. */
  changed: SessionField[]
  /**
   * The fields it wrote while the person was writing in them: the page kept the person's words,
   * and its own wait under the field as a suggestion, to use or dismiss.
   */
  suggested: SessionField[]
  reply: HelpReply | null
  /** Why it could not be asked, in the service's words. */
  problem: string | null
  /** The person took its change back. */
  undone: boolean
}

export const askedTurn = (id: string, said: string): HelpTurn => ({
  id,
  said,
  state: 'asking',
  progress: null,
  words: '',
  changed: [],
  suggested: [],
  reply: null,
  problem: null,
  undone: false,
})

const inOrder = (fields: readonly SessionField[]) =>
  sessionFields.filter((field) => fields.includes(field))

/** A turn after one more of its events. */
export function heardTurn(turn: HelpTurn, event: HelpEvent): HelpTurn {
  if (turn.state !== 'asking') return turn
  if (event.type === 'progress') return { ...turn, progress: event.progress }
  if (event.type === 'words') return { ...turn, words: event.text }
  return { ...turn, changed: inOrder([...turn.changed, ...event.changed]) }
}

/**
 * A turn after the page kept the person's words in fields it wrote: its words wait there. Said
 * while it runs or once it has ended, when the page reads what it wrote.
 */
export const suggestedTurn = (turn: HelpTurn, fields: readonly SessionField[]): HelpTurn => ({
  ...turn,
  suggested: inOrder([...turn.suggested, ...fields]),
})

/** The fields a turn changed in the draft as the person sees it: not those that wait as a suggestion. */
export const landedFields = (turn: Pick<HelpTurn, 'changed' | 'suggested'>) =>
  turn.changed.filter((field) => !turn.suggested.includes(field))

export const doneTurn = (turn: HelpTurn, reply: HelpReply): HelpTurn => ({
  ...turn,
  state: 'done',
  progress: null,
  words: '',
  changed: inOrder([...turn.changed, ...reply.changed]),
  reply,
})

/** The person pressed Stop: what it changed so far is in the draft, and the rest never comes. */
export const stoppedTurn = (turn: HelpTurn): HelpTurn => ({
  ...turn,
  state: 'stopped',
  progress: null,
  words: '',
})

export const failedTurn = (turn: HelpTurn, problem: string | null): HelpTurn => ({
  ...turn,
  state: 'failed',
  progress: null,
  words: '',
  problem,
})

/** The earlier turns a new one sends along: those that were answered, the latest few. */
export const earlierTurns = (turns: readonly HelpTurn[]) =>
  turns
    .flatMap((turn) => (turn.state === 'done' ? [earlierTurn(turn.said, turn.reply!.reply)] : []))
    .slice(-WRITING_HELP_EARLIER_TURNS)

const linkWords = (links: number) => (links === 1 ? '1 link' : `${links} links`)

/** What a running turn is doing, as its line says it. */
export function progressLine(progress: HelpProgress | null): string {
  if (!progress) return 'Starting'
  if (progress.doing === 'reading')
    return progress.links
      ? `Reading your message and ${linkWords(progress.links)}`
      : 'Reading your message'
  if (progress.doing === 'looking') return 'Looking at what is published'
  return progress.field ? `Writing ${fieldList([progress.field])}` : 'Writing the draft'
}

/** What a running turn is doing, as the strip in the draft says it, under writing help's name. */
export function workingLine(progress: HelpProgress | null): string {
  if (progress?.doing === 'reading')
    return progress.links
      ? `${HELP_NAME} is reading your message and ${linkWords(progress.links)}.`
      : `${HELP_NAME} is reading your message.`
  if (progress?.doing === 'looking') return `${HELP_NAME} is looking at what is published.`
  return `${HELP_NAME} is writing the draft. Your hands are free: it skips a field you type in.`
}

/**
 * What a turn read of a link the person gave, once it ended: that it read it, or why it did not.
 * Nothing for a message with no link.
 */
export function readLine(reply: HelpReply): string {
  if (reply.links.problem) return reply.links.problem
  return reply.links.read ? `Read your message and ${linkWords(reply.links.read)}` : ''
}

/** A field the person changed while it worked, said under the reply. */
export const keptLine = (kept: readonly SessionField[]) =>
  kept.length ? `Kept as you wrote it: ${fieldList(kept)}.` : ''

/**
 * The fields the person was writing in when writing help wrote them, said under the reply as its
 * own words: theirs stayed, and its version waits under each field.
 */
export const suggestedLine = (suggested: readonly SessionField[]) =>
  suggested.length
    ? `You were typing in ${fieldList(suggested)}, so I left your words and put mine under ${suggested.length > 1 ? 'them' : 'it'}. Use ${suggested.length > 1 ? 'them' : 'it'}, or keep yours.`
    : ''

/** A field the checks refused, said under the reply with the reason. */
export const refusedLine = (refused: { field: SessionField; why: string }) =>
  `${fieldList([refused.field])} is as it was. ${refused.why}`

const whatIsSafe = (changed: readonly SessionField[]) =>
  changed.length ? `What it changed is in your draft: ${fieldList(changed)}.` : 'Nothing changed.'

/**
 * Why a turn ended before writing help answered: what went wrong, what is safe (`changed`: the
 * fields it changed in the draft as the person sees it), what to do.
 */
export function stoppedLine(
  reply: HelpReply,
  changed: readonly SessionField[] = reply.changed,
): string {
  const safe = whatIsSafe(changed)
  switch (reply.stopped) {
    case null:
      return ''
    case 'steps':
      return `${HELP_NAME} stopped at its limit of steps before it finished. ${safe} Try again.`
    case 'time':
      return `${HELP_NAME} ran out of time before it finished. ${safe} Try again.`
    case 'spending':
      return `${reply.limit ?? `${HELP_NAME} reached its limit for AI cost.`} ${safe}`
    case 'model':
      return `${HELP_NAME} did not answer just now. ${safe} Try again.`
    case 'key':
      return `The AI provider refused the key. ${safe} Ask an admin to give it a key that works.`
    case 'credit':
      return `The AI provider says its account is out of credit. ${safe} Ask an admin to add credit.`
  }
}

/**
 * A turn that could not be asked, or whose stream dropped: the service's reason, or that it could
 * not be reached, and what it changed before that is in the draft.
 */
export function failedLine(problem: string | null, changed: readonly SessionField[]) {
  const safe = whatIsSafe(changed)
  return problem
    ? `Couldn't ask writing help. ${problem}${changed.length ? ` ${safe}` : ''}`
    : `Couldn't reach writing help. ${safe} Try again.`
}

/** A turn the person stopped. */
export const stoppedByPersonLine = (changed: readonly SessionField[]) =>
  `Stopped. ${whatIsSafe(changed)}`
