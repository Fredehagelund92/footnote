import type { AlertCardRule } from '@domain/alerts'
import { DRAFT_OLD_DAYS } from '@domain/inbox'
import type { CheckAnswer } from '@domain/question-link'
import type { DomainId, Fact } from './items'

// The Inbox as the app reads it (src/web/api): cards that need someone, what they sent that waits
// on others, and the setup checklist of a new install. Pure types and words.

/** A decision taken on a card: its outcome in a word or two, and when. */
export type Outcome = { label: string; at: string }

export type CardType =
  'names' | 'suggestion' | 'gap' | 'flag' | 'check' | 'look' | 'alert' | 'drafts'

/** Each card by what happened, so the word explains itself. */
export const cardTypeLabel: Record<CardType, string> = {
  names: 'New metrics and dimensions',
  suggestion: 'Suggestion',
  gap: 'Nothing written yet',
  flag: 'Reported',
  check: 'Due for a check',
  look: 'Needs a look',
  alert: 'Alert',
  drafts: 'Your drafts',
}

/**
 * The card of the names a read made, in words: what to do, not how it was found. Families of
 * near-identical metrics are counted apart from the single names (D1): "37 families and 6 names
 * from dbt".
 */
export function namesWords({
  ready,
  flagged,
  families = 0,
  tool,
}: {
  ready: number
  flagged: number
  /** Of them, the families waiting. */
  families?: number
  /** The definitions integration's tool: one is on at a time (CON-120). */
  tool: string
}) {
  const total = ready + flagged
  const others = total - families
  const from = `from ${tool}`
  const n = (x: number) => x.toLocaleString('en-GB')
  return {
    title: !total
      ? 'Names left out'
      : families
        ? `${families === 1 ? '1 family' : `${n(families)} families`}${others ? ` and ${others === 1 ? '1 name' : `${n(others)} names`}` : ''} ${from}`
        : `${total === 1 ? '1 new metric or dimension' : `${n(total)} new metrics and dimensions`} ${from}`,
    line: !total
      ? 'Every new name was left out.'
      : flagged
        ? `${ready} ready to publish, ${flagged} to look at first.`
        : ready === 1
          ? 'Ready to publish.'
          : 'All ready to publish.',
  }
}

/**
 * The card of the person's own drafts that wait for them (FR-139), in words: how many, and why
 * they wait. Nobody else is told of them.
 */
export function draftsWords({ imported, old }: { imported: number; old: number }) {
  const drafts = (n: number) => (n === 1 ? '1 draft' : `${n.toLocaleString('en-GB')} drafts`)
  return {
    title: !old
      ? `${drafts(imported)} from your import`
      : !imported
        ? `${drafts(old)} not saved for ${DRAFT_OLD_DAYS} days`
        : `${drafts(imported + old)} waiting for you`,
    line: `Only you can see ${imported + old === 1 ? 'it' : 'them'}. Agents get ${imported + old === 1 ? 'it' : 'them'} once ${imported + old === 1 ? 'it is' : 'they are'} published.`,
  }
}

/**
 * What the drafts card's button does with them: publish where the person may, and send the rest
 * to their domains' owners. "Publish all" or "Send all" when it takes every draft on the card;
 * otherwise how many: "Publish 19", "Publish 12, send 9".
 */
export function draftsVerb(publish: number, send: number, all = true) {
  const n = (x: number) => x.toLocaleString('en-GB')
  if (!send) return all ? 'Publish all' : `Publish ${n(publish)}`
  if (!publish) return all ? 'Send all' : `Send ${n(send)}`
  return `Publish ${n(publish)}, send ${n(send)}`
}

export type FieldChange = { label: string; before: string; after: string }

/** The third action of a Nothing written yet and a Due for a check card: it copies the card's link. */
export const ASK_SOMEONE = 'Ask someone who knows'

/** What someone answered on a Due for a check card's link, under their name. */
export type CheckAnswerRow = {
  by: string
  answer: CheckAnswer
  /** The day it ended, as people read it ("31 Mar 2026"), with the answer `ended`. */
  endedOn?: string | null
  words?: string | null
  link?: string | null
  /** When they answered, as the Inbox says it. */
  when: string
}

export type Suggestion = {
  /** The context item it changes; none for a new one. */
  factId?: string
  from: string
  /** Set when an agent sent it, with the person's OK: the agent's name (FR-420). */
  agent?: string
  via: string
  on: string
  note?: string
  changes: FieldChange[]
  draft: Fact
}

export type InboxCard = {
  id: string
  type: CardType
  domain: DomainId
  /** Whose Inbox it lands in. */
  for: string
  when: string
  title: string
  line: string
  detail: string
  primary: string
  secondary: string[]
  factId?: string
  /**
   * Why a check is due: a definition it relies on changed in its tool, its check date passed, or
   * a family of metrics it is about was split.
   */
  due?: 'source' | 'date' | 'family'
  /** The metrics a split family it is about reaches agents through now, by name. */
  splitInto?: string[]
  /** The definitions that changed in their tool, by name, when that is why a check is due. */
  changed?: string[]
  suggestion?: Suggestion
  /**
   * Not found: the scope agents asked about and how often (never their words, which are not
   * kept), and the item drafted for it, so the owner reviews a draft instead of a blank page.
   */
  gap?: {
    scope: string[]
    /** How often agents found nothing for it this week; null is fewer than 5, never none (FR-614). */
    times: number | null
    /** How often people in Ask told the owners this week that it is missing (Tell the owner). */
    told?: number
    belongs: string
    draft?: Fact
    acrossMonths?: string
  }
  /**
   * A report someone sent on purpose from a conversation: kept with their words, and their name.
   * One sent from Ask keeps the question they asked, as they wrote it.
   */
  flag?: {
    reason: 'wrong' | 'unclear'
    note: string
    when: string
    by: string
    via: string
    question?: string
    /** The words it should say, as the sender wrote them. */
    correction?: string
    /** A link the sender gave, an http or https address. */
    link?: string
    /** The card of the suggestion the words became, while it waits for an owner. */
    suggestion?: string
  }
  /** Raised by the saved-question alert: the questions that answer worse now, from Quality's one list. */
  look?: { questions: string[] }
  /**
   * Raised by an alert rule with a card of its own: the rule, its name, and where its one action
   * goes (a topic's answer panel, Overview, Usage, or an integration).
   */
  alert?: { rule: AlertCardRule; name: string; href: string; pair?: string }
  /**
   * The person's own drafts that wait for them (FR-139): their ids, oldest first, and how many were
   * imported or not saved for a while.
   */
  drafts?: { ids: string[]; imported: number; old: number }
  /**
   * Ask someone who knows: the day the card's link was last copied ("25 Nov"), never who opened
   * it, and on a Due for a check card what people answered there since it was last checked.
   */
  asked?: { on: string; answers: CheckAnswerRow[] }
  /** The names a read made: how many Publish all takes, how many need a look, and from what. */
  names?: { ready: number; flagged: number; families: number; tool: string }
  /**
   * Created by a sync from a document, never by a person: the tool as people say it, and its
   * connector's id, which its logo is drawn by.
   */
  source?: { tool: string; connector: string; folder: string; doc: string; read: string }
}

export type Waiting = {
  id: string
  for: string
  title: string
  waitingFor: string
  domain: DomainId
  sent: string
  /** The suggestion's card in the owner's Inbox, where its comments hang. */
  card: string
  /**
   * An owner returned it with a note, the first comment of its thread: it waits on the person,
   * who edits it and sends it again.
   */
  returned?: { by: string; when: string }
  /**
   * An owner closed it (Don't publish), with the reason they gave: it won't be published. Its row
   * tells the person once, until they open it.
   */
  closed?: { by: string; when: string; reason: string }
}

export type SetupStep = { id: string; title: string; description: string; action: string }
