import type { DraftFieldName } from './draft-stamps.ts'

/*
  Writing help (Route 3): Footnote's own help for writing one draft, in a dock beside the editor.
  The person says what happened or what to change, and a model changes the fields of their own
  draft, as them, through the write path an agent's write_draft uses, with its checks on every
  field. It writes one draft and nothing else: it never sends or publishes, never decides the
  fields only people decide (FR-121), and answers no question about the business, which is Ask's.
  The draft's words go to the model provider set for Ask, so it is off until an admin turns it on.
  The rules here are pure, shared by the service, the web app and its mock.
*/

/** The most turns one person may take in 24 hours, unless an admin set another (`limits.writing_help`). */
export const WRITING_HELP_TURNS_PER_DAY = 40
/** The most characters of one message, unless an admin set another (`limits.writing_help`). */
export const WRITING_HELP_PASTE_CHARACTERS = 12_000
/** The longest message the service reads at all, whatever an admin set. */
export const WRITING_HELP_MESSAGE_MAX = 100_000
/** The earlier turns of the chat the browser sends with a turn: the latest, each cut short. */
export const WRITING_HELP_EARLIER_TURNS = 6
export const WRITING_HELP_EARLIER_CHARACTERS = 2_000
/** The most of a linked page the model is given. */
export const WRITING_HELP_PAGE_CHARACTERS = 8_000
/** The most answers a question back offers to tap. */
export const WRITING_HELP_ANSWERS = 2

/**
 * The fields writing help writes, by the names an agent uses: every one an agent writes but the
 * domain, which is the person's to choose and starts as their own.
 */
export const helpFieldNames = [
  'title',
  'summary',
  'text',
  'kind',
  'scope',
  'window',
  'evidence',
  'not_to_conclude',
] as const satisfies readonly Exclude<DraftFieldName, 'area'>[]
export type HelpFieldName = (typeof helpFieldNames)[number]

/** Why a turn ended before writing help answered. */
export const helpStops = ['steps', 'time', 'spending', 'model', 'key', 'credit'] as const
export type HelpStop = (typeof helpStops)[number]

/**
 * The links in a message, in the order written, each once: only these are ever opened, never a
 * link a page or a model names. A link ends at a space, and loses the punctuation a sentence put
 * after it.
 */
export function linksIn(message: string): string[] {
  const found = message.match(/https?:\/\/[^\s<>"']+/gi) ?? []
  const links = found
    .map((link) => link.replace(/[)\].,;:!?]+$/, ''))
    .filter((link) => URL.canParse(link))
  return [...new Set(links)]
}

/** An earlier turn as it is sent again: what the person said and what writing help replied, cut short. */
export const earlierTurn = (said: string, reply: string) => ({
  said: [...said].slice(0, WRITING_HELP_EARLIER_CHARACTERS).join(''),
  reply: [...reply].slice(0, WRITING_HELP_EARLIER_CHARACTERS).join(''),
})

/** Why a message is over the limit, in a sentence the person reads. */
export const pasteTooLong = (characters: number, most: number) =>
  `That is ${characters.toLocaleString('en-GB')} characters, and writing help reads at most ${most.toLocaleString('en-GB')} at once. Paste the part that matters.`

/** A wait in words: "12 minutes", "3 hours". */
const waitWords = (seconds: number) => {
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`
  const hours = Math.ceil(minutes / 60)
  return hours === 1 ? '1 hour' : `${hours} hours`
}

/** Why one more turn is refused today, in a sentence the person reads. */
export const turnsUsedUp = (turns: number, waitSeconds: number) =>
  `You've used writing help ${turns} times in the last 24 hours, the most allowed. Try again in ${waitWords(waitSeconds)}, or change the draft yourself.`

/**
 * What a turn says when its model changed the draft, or tried to, and wrote no reply of its own:
 * fixed words, so a turn never ends in silence.
 */
export const fixedReply = (changed: boolean) =>
  changed
    ? 'I changed the draft. Check each field I wrote before you send it.'
    : 'I changed nothing in the draft.'

/** Why writing help is not there to ask. */
export const writingHelpOff = 'An admin has turned off writing help.'
export const writingHelpNoModel =
  'Writing help needs an AI model, and none is connected to this workspace.'
