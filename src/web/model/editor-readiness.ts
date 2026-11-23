// Whether an editor's form can go yet, and what is in the way: one answer for the button, the footer
// and the side panel of both editors (a context item and a definition), so they never disagree.
// The first thing in the way wins, in the order a person would fix it.

/** What agents read first; the service keeps the first paragraph to this many characters. */
export const SUMMARY_LIMIT = 280

export type Checks = {
  /** The parts still to fill in, as a person says them: "a title", "where it applies". */
  missing: string[]
  /** Why the word can't be used, when it already means something (definitions). */
  taken?: string
  /** The link in Source is not one the service can open (context items). */
  badLink?: boolean
  /** The first paragraph is longer than agents read (context items). */
  tooLong?: boolean
  /** Nothing differs from what is saved. */
  unchanged?: boolean
  /** The title of the first overlapping item still to be answered (context items). */
  unanswered?: string
}

export type Readiness =
  | { state: 'ready' }
  | { state: 'missing'; missing: string[] }
  | { state: 'taken'; reason: string }
  | { state: 'bad-link' }
  | { state: 'too-long' }
  | { state: 'unchanged' }
  | { state: 'unanswered'; title: string }

export function readinessOf(c: Checks): Readiness {
  if (c.missing.length) return { state: 'missing', missing: c.missing }
  if (c.taken) return { state: 'taken', reason: c.taken }
  if (c.badLink) return { state: 'bad-link' }
  if (c.tooLong) return { state: 'too-long' }
  if (c.unchanged) return { state: 'unchanged' }
  if (c.unanswered) return { state: 'unanswered', title: c.unanswered }
  return { state: 'ready' }
}

/**
 * The sentence for a button that does nothing yet, and for its tooltip; empty when it can go. The
 * parts still missing are joined as the editor says them: a list, or two with "and".
 */
export function holdLine(r: Readiness, join = ', ') {
  switch (r.state) {
    case 'ready':
      return ''
    case 'missing':
      return `Add ${r.missing.join(join)} first.`
    case 'taken':
      return r.reason
    case 'bad-link':
      return 'Fix the link in Source first.'
    case 'too-long':
      return `Shorten the first paragraph to ${SUMMARY_LIMIT} characters first.`
    case 'unchanged':
      return 'Nothing has changed yet.'
    case 'unanswered':
      return `Say how this relates to “${r.title}” first.`
  }
}

export type Standing = {
  /** The editor's mode: a suggested change starts from a live item's page. */
  mode: 'new' | 'edit' | 'suggest'
  /** Not published yet: a draft nobody has published. */
  draft: boolean
  /** It is sent to the owners instead of published: the person doesn't own its domain. */
  suggests: boolean
  /** Who wrote the draft, when it is someone else. */
  writer?: string | undefined
  /** The owner who decides a suggestion, and their domain. */
  owner: string
  domain: string
}

/**
 * The line above the title: whether agents have it now, and what the button does with it. Empty
 * where there is nothing to say (a new item, or an owner's edit of a live one).
 */
export function standingLine(s: Standing) {
  if (s.draft) {
    const never = "never published, so agents don't have it yet."
    if (s.suggests)
      return `This draft was ${never} ${s.owner}, owner of ${s.domain}, decides whether to publish it once you send it.`
    return s.writer
      ? `${s.writer} wrote this draft. It was ${never} Publish makes it live, with ${s.writer} as its writer.`
      : `This draft was ${never} Publish makes it live.`
  }
  if (s.mode === 'suggest')
    return `You're suggesting a change. ${s.owner}, owner of ${s.domain}, decides; agents keep getting the context item as it is until then.`
  return ''
}
