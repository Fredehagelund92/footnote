/*
  The Inbox's rules (docs/product.md, section 5): cards grouped by need,
  what each card's one decision is, and the steps of a new workspace's setup checklist. Pure:
  the service reads the records, this says how they line up.
*/

/**
 * The groups, in the order of need: the names a read made first, since nothing can be written
 * about a metric until it has one, then what agents couldn't answer, then what people reported,
 * saved questions that answer worse, what an alert rule raised, comments that mention the person,
 * items needing a recheck, suggestions, and last the person's own drafts that wait for them. Under
 * All: what the person sent that waits on others, and what is done.
 */
export const cardGroups = [
  'names',
  'gap',
  'flag',
  'look',
  'alert',
  'mention',
  'check',
  'suggestion',
  'drafts',
  'waiting',
  'done',
] as const
export type CardGroup = (typeof cardGroups)[number]

/** The decision a card offers besides opening what it is about (FR-616, FR-618, CON-211, FR-218). */
export const cardActions = ['not_written', 'not_a_problem', 'still_true', 'archive'] as const
export type CardAction = (typeof cardActions)[number]

/** Which card each decision belongs to: a Nothing written yet, a Reported, or a Needs a recheck card. */
export const actionGroup: Record<CardAction, 'gap' | 'flag' | 'check'> = {
  not_written: 'gap',
  not_a_problem: 'flag',
  still_true: 'check',
  archive: 'check',
}

/** A card's name, by what it shows: stable across reads, so a read receipt or a closing finds it. */
export const cardKey = {
  proposal: (id: string) => `proposal:${id}`,
  gap: (id: string) => `gap:${id}`,
  feedback: (id: string) => `feedback:${id}`,
  /** A person's named report from Ask (FR-622). */
  report: (id: string) => `report:${id}`,
  check: (itemId: string) => `check:${itemId}`,
  /** A thread with comments that mention the person: "mention:review:<id>", "mention:context:<id>". */
  mention: (subject: string) => `mention:${subject}`,
  /** A domain's saved questions that need a look, raised by their alert (FR-526, FR-621). */
  look: (areaId: string) => `look:${areaId}`,
  /** A raise of an alert rule that has a card of its own (FR-621). */
  alert: (raiseId: string) => `alert:${raiseId}`,
  /** The names a read made, one card however many sources made them (FR-141). */
  names: () => 'names:waiting',
  /** The person's own suggestion an owner closed (Don't publish), as their Inbox tells them. */
  closed: (proposalId: string) => `closed:${proposalId}`,
  /** The person's own drafts that were imported or left for a while: one card for all of them. */
  drafts: () => 'drafts:yours',
}

/**
 * A draft its writer has not saved for this many days waits on their Inbox's drafts card, as an
 * imported one does at once (FR-139): a draft only they can see is easily forgotten.
 */
export const DRAFT_OLD_DAYS = 30

type CardKind =
  | 'proposal'
  | 'gap'
  | 'feedback'
  | 'report'
  | 'check'
  | 'mention'
  | 'look'
  | 'alert'
  | 'names'
  | 'closed'
  | 'drafts'

/** What a card's name says it is, or null for a name that is none of them. */
export function parseCardKey(key: string): { kind: CardKind; id: string } | null {
  const match =
    /^(proposal|gap|feedback|report|check|mention|look|alert|names|closed|drafts):(.+)$/.exec(key)
  return match ? { kind: match[1] as CardKind, id: match[2]! } : null
}

/**
 * Cards by need, then newest first within a group, then by name, so two reads of the same records
 * give the same order. A done card goes under Done, whatever it was.
 */
export function byNeed<T extends { group: CardGroup; at: string; id: string; done: unknown }>(
  cards: readonly T[],
): T[] {
  const rank = (card: T) => cardGroups.indexOf(card.done ? 'done' : card.group)
  return [...cards].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** How many cards each group holds, in the groups' order, groups with none left out. */
export function groupCounts<T extends { group: CardGroup; done: unknown }>(
  cards: readonly T[],
  waiting = 0,
): { group: CardGroup; count: number }[] {
  const counts = new Map<CardGroup, number>()
  for (const card of cards) {
    const group = card.done ? 'done' : card.group
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  if (waiting) counts.set('waiting', waiting)
  return cardGroups
    .filter((g) => counts.has(g))
    .map((group) => ({ group, count: counts.get(group)! }))
}

/**
 * The setup checklist of a new workspace (FR-816), ask first: publish the names of where metrics
 * are defined, under the first domain, since a question and a context item name a metric; ask about
 * a number you know and get Not found; write what you know and ask again, to get Checked; then ask
 * your own agent.
 */
export const setupSteps = ['definitions', 'ask', 'fact', 'agent'] as const
export type SetupStep = (typeof setupSteps)[number]
