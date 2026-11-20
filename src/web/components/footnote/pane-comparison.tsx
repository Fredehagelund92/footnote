import { FieldsDiff, TextComparison } from '@/components/footnote/source-review'
import { missingWords } from '@/lib/review-compare'
import { useMe } from '@/lib/workspace'
import type { Review } from '@/model/review'

// The comparison where a review is looked at, not worked on: the Inbox pane and the dock. The same
// Fields table and text as the review page, every change at once, with no bar (the pane's head
// already says who sent it) and no comments. Its own module, so the quick view, which the first
// screen loads, loads the comparison only once a suggestion is opened.

export default function PaneComparison({ r }: { r: Review }) {
  const me = useMe()
  return (
    <div className="@container flex flex-col gap-4">
      <FieldsDiff before={r.fields.before} after={r.fields.after} person={me.name} />
      <TextComparison before={r.source.before} after={r.source.after} missing={missingWords(r)} />
    </div>
  )
}
