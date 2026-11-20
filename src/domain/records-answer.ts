import * as z from 'zod/mini'

/*
  Parts of Ask's answers apart from the reads, so the API's contract, which the web app loads
  first, carries the shape and not the reads: the kinds of context item the records count, and
  the footer every answer owes the reader.
*/

/** The kinds the Context list shows. */
export const recordsKinds = ['event', 'issue', 'note', 'guide'] as const
export type RecordsKind = (typeof recordsKinds)[number]

/**
 * What every answer owes the reader, in one place: what a count is out of, what the read could not
 * see, and what in it may be out of date.
 */
export const footerSchema = z.object({
  denominator: z.nullable(z.string()),
  notSeen: z.nullable(z.string()),
  stale: z.nullable(z.string()),
})
export type AnswerFooter = z.infer<typeof footerSchema>
