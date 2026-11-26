import type { Fact } from './items'

// A suggestion waiting for review, as people read it: who sent it, how long it has waited, and
// who decides. One place for those words, so the Context list, the item page and the peek say the
// same. Pure: the day and the people come in.

/** Whole days from the day it was sent to today, both ISO dates; never below 0. */
export function waitedDays(sentAt: string, today: string): number {
  const days = Math.round((Date.parse(today) - Date.parse(sentAt.slice(0, 10))) / 86_400_000)
  return Math.max(0, days)
}

/** How long ago, in the words of a sentence: "today", "yesterday", "3 days ago". */
export function agoWords(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days.toLocaleString('en-GB')} days ago`
}

/** Who sent it and when: "Maria Lindqvist sent it 3 days ago", "You sent it today". */
export function sentWords(f: Pick<Fact, 'by' | 'sentAt'>, me: string, today: string): string {
  const ago = f.sentAt ? ` ${agoWords(waitedDays(f.sentAt, today))}` : ''
  if (!f.by) return `Sent${ago}`
  return `${f.by === me ? 'You' : f.by} sent it${ago}`
}

/**
 * Who decides, the owners of its domain: "You or Sofia Brandt decide", "Jon Abara decides". With no
 * owner, an admin decides.
 */
export function decidesWords(owners: readonly string[], me: string): string {
  if (!owners.length) return 'An admin decides'
  const named = owners.includes(me) ? ['You', ...owners.filter((o) => o !== me)] : [...owners]
  const who =
    named.length === 1 ? named[0]! : `${named.slice(0, -1).join(', ')} or ${named.at(-1)!}`
  return `${who} ${named.length === 1 && named[0] !== 'You' ? 'decides' : 'decide'}`
}

/**
 * The row's and the page's one line: "Maria Lindqvist sent it 3 days ago. You or Sofia Brandt
 * decide." Its sender never decides it, even as an owner of its domain.
 */
export function waitingLine(
  f: Pick<Fact, 'by' | 'sentAt'>,
  owners: readonly string[],
  me: string,
  today: string,
): string {
  const deciders = owners.filter((o) => o !== f.by)
  return `${sentWords(f, me, today)}. ${decidesWords(deciders, me)}.`
}
