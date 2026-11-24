import { count, PUBLISH_MAX, type Skip } from '@/lib/bulk'

// What a Publish says about the rows it takes and leaves: kept out of bulk.ts, which the first load
// carries, because only the Publish dialog, the drafts reader and the Context bar read them.

/** What a Publish's toast says under its line: when agents get it, or them. */
export const publishedWhen = (published: number, sent = 0) =>
  published
    ? `Agents get ${published === 1 ? 'it' : 'them'} from the next question.`
    : sent === 1
      ? 'Agents get it once an owner publishes it.'
      : 'Agents get them once an owner publishes them.'

/** The line above the bar after a Publish took its batch: "4 drafts are still ticked: ...". */
export const nextLine = (n: number) =>
  `${count(n, 'draft')} ${n === 1 ? 'is' : 'are'} still ticked: one Publish takes ${PUBLISH_MAX}.`

/** A reason a row was left alone, as a clause after its count: "are published", "wait for review". */
function leftAs(why: string, n: number) {
  const one = n === 1
  if (why === 'published') return `${one ? 'is' : 'are'} published`
  if (why === 'archived') return `${one ? 'is' : 'are'} archived`
  if (why === 'waiting for review') return `${one ? 'waits' : 'wait'} for review`
  if (why.startsWith('owned by ')) return `${one ? 'is' : 'are'} ${why}`
  return `${one ? 'needs' : 'need'} a fix first`
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** The rows left alone by kind of reason, in the order they first came. */
function byReason(skipped: Skip[]) {
  const groups = new Map<string, number>()
  for (const s of skipped) {
    const key = leftAs(s.why, 2)
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const whyOf = new Map(skipped.map((s) => [leftAs(s.why, 2), s.why]))
  return [...groups].map(([key, n]) => ({ why: whyOf.get(key)!, n }))
}

/**
 * Why a Publish has nothing to do, said on the bar at once rather than on a hover: "Nothing to
 * publish: these 3 are published already.", or by reason with what to do next.
 */
export function nothingToPublish(skipped: Skip[]) {
  if (!skipped.length) return 'Nothing to publish.'
  const groups = byReason(skipped)
  const why = skipped[0]!.why
  if (skipped.length === 1)
    return why === 'published'
      ? 'Nothing to publish: it is published already.'
      : why === 'waiting for review'
        ? 'Nothing to publish: it waits for review. Open it to decide it.'
        : leftAs(why, 1) === 'needs a fix first'
          ? `Nothing to publish: ${lowerFirst(skipped[0]!.reason)}`
          : `Nothing to publish: it ${leftAs(why, 1)}.`
  if (groups.length === 1 && why === 'published')
    return `Nothing to publish: these ${skipped.length} are published already.`
  const clauses = groups.map(({ why, n }) => `${n} ${leftAs(why, n)}`).join(', ')
  const next = skipped.some((s) => s.why === 'waiting for review')
    ? ' Open one to decide it.'
    : skipped.some((s) => leftAs(s.why, 2) === 'need a fix first')
      ? ' Open one to fix it.'
      : ''
  return `Nothing to publish: ${clauses}.${next}`
}

/**
 * What a Publish's confirmation leaves alone, as information rather than failure: "2 published
 * items you ticked stay as they are. 3 more are not in this Publish: 2 wait for review, 1 needs a
 * fix first."
 */
export function leftOutLine(skipped: Skip[], from: 'ticked' | 'card' = 'ticked') {
  const published = skipped.filter((s) => s.why === 'published').length
  const rest = skipped.filter((s) => s.why !== 'published')
  const parts: string[] = []
  if (published)
    parts.push(
      published === 1
        ? 'A published item you ticked stays as it is.'
        : `${published} published items you ticked stay as they are.`,
    )
  if (rest.length) {
    const who = published ? 'more' : from === 'card' ? 'on the card' : 'you ticked'
    const clauses = byReason(rest)
      .map(({ why, n }) => `${n} ${leftAs(why, n)}`)
      .join(', ')
    parts.push(
      `${rest.length} ${who} ${rest.length === 1 ? 'is' : 'are'} not in this Publish: ${clauses}.`,
    )
  }
  return parts.join(' ')
}
