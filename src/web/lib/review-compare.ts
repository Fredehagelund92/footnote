import * as React from 'react'
import { storageKey } from '@/lib/brand'
import { passagesChanged } from '@/lib/passage-diff'
import { fieldRows } from '@/model/review-fields'
import type { Review } from '@/model/review'

// The comparison's own state: what it counts (the parts that change, the stops N and P go
// through), and whether a person's review shows only the fields that change, as they last left the
// switch: on until they turn it off, then the way they left it, on every review in this browser.

const key = (person: string) => storageKey(`review-only-changed:${person}`)

function read(person: string) {
  try {
    return localStorage.getItem(key(person)) !== 'all'
  } catch {
    return true
  }
}

export function useOnlyChanged(person: string) {
  const [only, setOnlyState] = React.useState(() => read(person))
  // Another person signed in on the same page reads their own choice.
  const [was, setWas] = React.useState(person)
  if (was !== person) {
    setWas(person)
    setOnlyState(read(person))
  }
  const setOnly = React.useCallback(
    (next: boolean) => {
      setOnlyState(next)
      try {
        localStorage.setItem(key(person), next ? 'changed' : 'all')
      } catch {
        // Storage can be blocked; the switch still works on this page.
      }
    },
    [person],
  )
  return [only, setOnly] as const
}

/**
 * What the comparison counts for a review: the parts the bar counts (each field, and the text as
 * one) that change and that stay the same, and the stops N and P step through in the text as it
 * reads (each changed field row and each changed passage).
 */
export function compareCounts(r: Pick<Review, 'fields' | 'source'>) {
  const rows = fieldRows(r.fields.before, r.fields.after)
  const fields = rows.filter((x) => x.changed).length
  const passages = passagesChanged(r.source.before, r.source.after)
  return { changed: fields, same: rows.length - fields, fields, passages }
}
