import * as React from 'react'
import { Button } from '@/components/ui/button'
import { PaneFoot, PaneHead, PrimaryAction } from '@/components/footnote/inbox-pane'
import { PublishDialog } from '@/components/footnote/publish-dialog'
import { DomainDot } from '@/components/footnote/tag-chip'
import { toApiError } from '@/api/errors'
import { CONFIRM_ABOVE, count, PUBLISH_MAX, publishedLine, publishedWhen } from '@/lib/bulk'
import { publishSplit, usePublishDrafts } from '@/lib/publish-drafts'
import { href, navigate } from '@/lib/router'
import { useOnline } from '@/lib/send'
import { toast } from '@/lib/toast'
import { useUndo } from '@/lib/undo'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import { draftsVerb, type InboxCard } from '@/model/inbox'
import { paneState } from '@/model/inbox-pane'

// The person's own drafts card in the Inbox's pane (FR-139): the drafts they imported, or left for
// a while, that only they can see. One button publishes each where they may and sends the rest to
// their domains' owners, as the Context list's Publish does; more than a handful is asked first.

/** What the pane shows for the card, framed by the Inbox's own panel. */
export default function DraftsReview({
  card,
  onFinished,
  frame,
}: {
  card: InboxCard
  /** The card is done: every draft on it went, or left the person's list. */
  onFinished: () => void
  frame: (body: React.ReactNode, foot: React.ReactNode) => React.ReactNode
}) {
  const me = useMe()
  const domains = useDomains()
  const facts = useFacts()
  const online = useOnline()
  const undo = useUndo()
  const publishDrafts = usePublishDrafts()
  const [asking, setAsking] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const who = { name: me.name, admin: me.admin }
  // The drafts as the person's list has them now, oldest first; the most one Publish takes.
  const ids = card.drafts?.ids ?? []
  const rows = ids.flatMap((id) => facts.filter((f) => f.id === id && f.status === 'Draft'))
  const taken = rows.slice(0, PUBLISH_MAX)
  const split = publishSplit(taken, who, domains)
  const held = new Map(split.plan.skipped.map((s) => [s.id, s.why]))
  const more = rows.length - taken.length

  const publish = async () => {
    setBusy(true)
    try {
      const done = await publishDrafts(taken, 'Published from the Inbox.')
      const line = publishedLine(
        done.published.length,
        done.sent.length,
        done.failed.length,
        done.to,
      )
      if (!done.published.length && !done.sent.length) {
        toast(line, { description: done.skipped[0]?.reason })
        return
      }
      undo.offer(line, done.undo, { description: publishedWhen(done.published.length) })
      if (done.published.length + done.sent.length === rows.length) onFinished()
    } catch (error) {
      toast("Couldn't publish them", { description: toApiError(error).message })
    } finally {
      setBusy(false)
    }
  }
  const go = () => {
    if (split.plan.act.length > CONFIRM_ABOVE) setAsking(true)
    else void publish()
  }

  // The one thing worth saying beside the button: what it leaves, else where they go.
  const follows = !split.plan.act.length
    ? 'Each needs a fix first: open it from the list'
    : held.size
      ? `${count(held.size, 'draft')} ${held.size === 1 ? 'needs' : 'need'} a fix first`
      : more
        ? `${PUBLISH_MAX} at a time: ${more.toLocaleString('en-GB')} more after these`
        : split.send
          ? split.publish
            ? `${count(split.send, 'draft')} ${split.send === 1 ? 'goes' : 'go'} to the owners of ${split.to}`
            : `Agents get them once an owner of ${split.to} publishes them`
          : 'Agents get them from the next question'

  const body = (
    <>
      <PaneHead
        state={paneState(card)}
        domain={card.domain || undefined}
        title={card.title}
        summary={card.line}
      />
      <div className="max-w-2xl px-4 pb-6 @md:px-7">
        <ul aria-label="Your drafts" className="rounded-md border text-sm">
          {rows.map((f) => (
            <li key={f.id} className="border-b last:border-b-0">
              <a
                href={href(`/context/${f.id}`)}
                className="flex items-center gap-2.5 px-3 py-2 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <DomainDot id={f.domain} />
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
                {held.has(f.id) && (
                  <span className="shrink-0 text-xs text-muted-foreground">{held.get(f.id)}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <PublishDialog
        open={asking}
        onOpenChange={setAsking}
        publish={split.publishing.map((f) => f.title)}
        send={{ titles: split.sending.map((f) => f.title), domains: split.to }}
        skipped={split.plan.skipped}
        onPublish={() => void publish()}
      />
    </>
  )
  const foot = (
    <PaneFoot follows={online ? follows : "Offline: changes wait until you're back."}>
      <Button variant="outline" size="lg" onClick={() => navigate('/context', { status: 'draft' })}>
        See them in Context
      </Button>
      <PrimaryAction disabled={!online || busy || !split.plan.act.length} onClick={go}>
        {draftsVerb(split.publish, split.send, split.plan.act.length === rows.length)}
      </PrimaryAction>
    </PaneFoot>
  )
  return frame(body, foot)
}
