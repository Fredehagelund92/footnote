import { CHAT_LINE, CHAT_SOURCES, LOOP_REPLY, type ChatTurn } from '@domain/ask-chat'
import type { AnswerFooter } from '@domain/records-answer'
import type { ChosenPeriodInput, LoopTurn } from '@contract/answer'
import type { MentionRef } from '@/lib/mentions'
import { ANSWER_LINES } from '@/lib/help-content'
import type { DomainId } from './items'

// An answer in Ask as the app reads it (src/web/api): its state, its words with numbered sources,
// and what it was read as. Pure types and the words each state is said with.

export type AnswerState = 'grounded' | 'partial' | 'missing' | 'conflict' | 'stale' | 'failed'

/** The state words people see, in the app and in agents: from the one list Help and the docs share. */
export const stateLabel = Object.fromEntries(ANSWER_LINES.map((l) => [l.state, l.label])) as Record<
  AnswerState,
  string
>
/** The one short sentence under the words, for every state but Checked. */
export const stateSentence = Object.fromEntries(
  ANSWER_LINES.map((l) => [l.state, l.sentence]),
) as Record<AnswerState, string>
/** The longer form, kept as the explanation. */
export const stateLong = Object.fromEntries(ANSWER_LINES.map((l) => [l.state, l.long])) as Record<
  AnswerState,
  string
>

/**
 * The state an answer counts under where agents' calls are counted (Asked this week,
 * Observability): a question that looked nothing up counts as Not found there, as the service
 * counts it. Ask itself never shows Not found for it.
 */
export const countedState = (a: Pick<Answer, 'state'>): AnswerState => a.state ?? 'missing'

/** An answer from a draft: the words nobody has checked yet never say "checked". */
export const DRAFT_LABEL = 'Based on this draft'

/**
 * Why a question that names no metric and no market was not looked up, as Ask says it. Agents are
 * told the engine's own words, with its first choices (`said`); a person gets what Ask can answer
 * and the names closest to their words instead.
 */
export const NAMES_NOTHING = "The question doesn't name a metric or a market."

/** What a question was read as, in words: "Orders in Norway, 1 to 31 Aug 2026". Empty when nothing matched. */
export function scopeText(a: Pick<Answer, 'metric' | 'markets' | 'dates'>) {
  const what = [a.metric, a.markets.join(' and ')].filter(Boolean).join(' in ')
  return `${what}${what && a.dates ? `, ${a.dates}` : ''}`
}

export type Answer = {
  id: string
  question: string
  /**
   * Ask's loop (FR-718 to FR-720): the turn as the service wrote it, which the loop's own answer
   * draws (src/web/components/footnote/loop-answer.tsx); the fields below are read from it.
   */
  loop?: LoopTurn
  metric: string
  markets: string[]
  dates?: string
  /**
   * How sure the context is, or null when nothing was looked up: the question named nothing the
   * context is about, so there is no answer state (the engine's `need_more_detail`). Not found is
   * only for a question that was looked up and found nothing.
   */
  state: AnswerState | null
  note?: string
  /** Plain sentences; [n] points at sources[n - 1]. */
  text: string
  sources: string[]
  said: string
  /** You reported a part of this answer: when, and what the owner did, shown only in this chat. */
  report?: { on: string; outcome?: string }
  /** A Conflict's items that disagree with each other, by id: the ones an owner chooses between. */
  conflict?: string[]
  /** Items that apply to the scope but not to this question (a disagreement about something else), listed, not used. */
  related?: string[]
  /** The question as typed, with its mentions, when it had any. */
  parts?: QuestionPart[]
  /**
   * For a question about what a metric means: what its definition source says, and where that
   * comes from, as agents get it (FR-703). It changes neither the state nor the sources.
   */
  definitions?: AskedDefinition[]
  /** What the asker scoped it to with '@'. */
  scope?: MentionRef[]
  /** The period the person chose for it on the read line (R12): asking again keeps it. */
  period?: ChosenPeriodInput
  /** A short question Ask asked back: nothing was read, so there is no state; `text` says it. */
  reply?: 'clarify'
  /** What it owes the reader: what a count is out of, what it could not see, what may be stale. */
  footer?: AnswerFooter
  /**
   * The last question, asked again because the person said so in words ("try again"): what was
   * asked. `question` and `parts` stay what they typed.
   */
  again?: { question: string; parts?: QuestionPart[]; scope?: MentionRef[] }
  /**
   * An answer of Ask's loop (FR-718 to FR-720): what it read, each line written by code from its
   * reads (FR-720.9), and the reads themselves, by tool and input, which the next question sends
   * back so the service reads them again.
   */
  read?: string[]
  reads?: { tool: string; input: Record<string, unknown> }[]
  /** The readings Ask's question back offers, each a reply the person can send. */
  choices?: string[]
  /** Why the loop stopped before an answer, when it did: its fixed sentence is the text. */
  stopped?: 'steps' | 'time' | 'spending' | 'model' | 'key'
}

/** The question an answer read: the one it repeated, when it was asked again in words. */
export const askedOf = (a: Pick<Answer, 'question' | 'again'>) => a.again?.question ?? a.question

const clipped = (line: string) =>
  line.length > CHAT_LINE ? `${line.slice(0, CHAT_LINE - 1).trimEnd()}…` : line

/** How a turn was read, in words. */
function understoodOf(a: Answer) {
  const read = scopeText(a)
  return read ? clipped(read) : null
}

const items = (n: number) => (n === 1 ? '1 context item' : `${n} context items`)

/**
 * What a turn answered, in one sentence: how much was found, from a template. Never an item's
 * words, a name or a data value.
 */
function headlineOf(a: Answer) {
  if (a.state === null || a.state === 'failed') return null
  const about = scopeText(a)
  return clipped(`${items(a.sources.length)}${about ? ` about ${about}` : ''}.`)
}

/** What a turn sends on to the next question: none for one with no question. */
export const chatTurnOf = (a: Answer): ChatTurn | undefined =>
  askedOf(a).trim()
    ? {
        question: askedOf(a),
        sources: a.sources.slice(0, CHAT_SOURCES),
        understood: understoodOf(a),
        headline: headlineOf(a),
        ...(a.reply === 'clarify' ? { asked: a.text } : {}),
        // Ask's loop reads its earlier reply as it wrote it: its nouns as their typed mentions.
        ...(a.reads
          ? { reply: (a.loop?.said || a.text).slice(0, LOOP_REPLY), reads: a.reads }
          : {}),
      }
    : undefined

/** A metric's definition, as the definition source gives it. */
export type AskedDefinition = {
  name: string
  /** The source's own words; null when it gives none. */
  words: string | null
  /** The tool the source reads, as people say it: "Cube". */
  tool: string
}

export type QuestionPart = string | MentionRef

export type Example = {
  id: string
  label: string
  question: string
  /** One of the questions a new workspace's empty Ask starts with. */
  starter?: boolean
}

/** When a chat was, as the history groups them. */
export type Day = 'Today' | 'Yesterday' | 'Earlier'

/** A chat under Ask: the person's own, kept for them. What agents ask is kept as scopes and counts, never as conversations. */
export type Thread = {
  id: string
  title: string
  question: string
  /** The curated example this chat replays, if any. */
  example?: string
  day: Day
  /** Clock time today and yesterday, a short date before that. */
  time: string
  /** Seeded from the demo world, so hidden on a fresh install. */
  seed?: boolean
  /** What its first answer said, without the source marks: what the history search reads. */
  preview: string
  /**
   * Ask's loop: the chat's finished answers, kept in the browser with it (FR-717), so opening it
   * again shows them as they were and asks nothing again.
   */
  answers?: Answer[]
}

/** What Ask is asked: typed words with their mentions and scope, or one of the curated examples. */
export type AskInput = {
  question?: string
  parts?: QuestionPart[]
  /** What the asker scoped it to with '@'. */
  scope?: MentionRef[]
  example?: string
  /** The chat's last turns, oldest first, for a follow-up. */
  turns?: ChatTurn[]
  /** The period the person chose on the read line, over the dates in the words (R12). */
  period?: ChosenPeriodInput
}

/** What the owners did after a named report, the first of them. */
export type ReportOutcomeKind = 'not_a_problem' | 'checked' | 'changed' | 'archived'

/** A report the person sent from Ask: when, and what the owners did after it, in words. */
export type SentReport = {
  id: string
  /** The question it was about, as asked: the chat shows the outcome under that answer. */
  question: string
  /** When it was sent, as the chat says it: "just now", "today", "on 23 Oct". */
  on: string
  /** What the owners did, once they did: "Checked again on 16 Oct after your report: still true." */
  outcome?: string
}

const SHORT = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const shortDay = (at: Date) => `${at.getDate()} ${SHORT[at.getMonth()]}`

/** When a report was sent, as "You reported this ..." finishes. */
export function reportedOn(at: Date, now: Date) {
  if (now.getTime() - at.getTime() < 2 * 60_000) return 'just now'
  if (at.toDateString() === now.toDateString()) return 'today'
  return `on ${shortDay(at)}`
}

/** What the owners did after a report, as the chat says it. */
export function reportOutcomeWords(kind: ReportOutcomeKind, at: Date) {
  const on = shortDay(at)
  return {
    checked: `Checked again on ${on} after your report: still true.`,
    changed: `Changed on ${on} after your report. Agents get the new version.`,
    archived: `Archived on ${on} after your report. Agents no longer get it.`,
    not_a_problem: `Looked at on ${on} after your report: not a problem. The context item stays as it is.`,
  }[kind]
}

/** How many topics show at first; the rest open in place under More asked this week. */
export const ASKED_ROWS = 4

export type AskedRow = {
  /** The topic it is: its id, its domain when it has one, its metric and market as named, its month. */
  topic: { id: string; domain?: DomainId; metric: string; where: string; month?: string }
  /** What the row says: "Orders in Norway". */
  title: string
  /** What a click asks. */
  question: string
  /** How often, for sorting: the total, or what its shown months add up to. */
  times: number
  /** How often, as shown: "31", or "13+" when a month under 5 would be given away. */
  count: string
  /** How many of this week's calls delivered nothing; null under the minimum. */
  nothing: number | null
  state: AnswerState
  sources: number
  /** For an owner of the topic's domain, on a Not found row: the draft or the suggestion that waits. */
  next?: { label: string; href: string }
}

/** Asked this week: the topics agents asked about most, as counts only. */
export type AskedWeek = {
  /** Every topic asked 5 times or more, most asked first. */
  rows: AskedRow[]
  /** Calls about topics asked fewer than 5 times: counted, never shown. */
  hidden: number
  /**
   * Every call this week; null when fewer than 5, or when it would give a small count away beside
   * the rows (then `askedAtLeast` is what the rows show together).
   */
  asked: number | null
  askedAtLeast?: number
}
