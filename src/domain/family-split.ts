/**
 * What splitting a family of metrics back into its metrics says (FR-142, D2): the same words in the
 * dialog that confirms it, on the Inbox card of each context item about it, and in what is left.
 * Pure, so the service, the mock binding and the screens say the same.
 */

/** Names in a sentence: "A", "A and B", "A, B and C". */
export function andList(names: readonly string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '')
}

/** "both", "all 3": the metrics a split family's items keep applying to. */
export const eachOf = (count: number) =>
  count === 2 ? 'both' : `all ${count.toLocaleString('en-GB')}`

/** The button that splits a family, and its toast: "Split into 2 metrics". */
export const splitLabel = (count: number) => `Split into ${count.toLocaleString('en-GB')} metrics`

/** The Inbox card's one decision for an item about a split family: keep it for each metric. */
export const keepLabel = (count: number) => `Keep for ${eachOf(count)}`

/** Why an item about a split family is due for a check, as its Inbox card opens with it. */
export function splitCardLine(family: string, metrics: readonly string[]): string {
  return `Its family ${family} was split into ${andList(metrics)}. No word of it changed: it reaches agents for ${eachOf(metrics.length)} until you say which it is about.`
}

/** Why an item about a split family may be out of date, as its page says it. */
export const splitDue = (family: string) => `Its family ${family} was split.`
