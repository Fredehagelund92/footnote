import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { PencilIcon, TriangleAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { PaneFoot, PaneHead, PrimaryAction } from '@/components/footnote/inbox-pane'
import { ItemDocument } from '@/components/footnote/item-document'
import { PeekAttention } from '@/components/footnote/peek'
import { PublishDialog } from '@/components/footnote/publish-dialog'
import { DomainDot } from '@/components/footnote/tag-chip'
import { itemPageQuery, useWrite } from '@/api/queries'
import { toApiError } from '@/api/errors'
import {
  CONFIRM_ABOVE,
  count,
  draftReadiness,
  PUBLISH_MAX,
  publishedLine,
  publishedWhen,
  publishesNow,
} from '@/lib/bulk'
import { pageKey } from '@/lib/keys'
import { publishSplit, usePublishDrafts } from '@/lib/publish-drafts'
import { changeQuery, href, navigate, useRoute } from '@/lib/router'
import { useOnline } from '@/lib/send'
import { today } from '@/lib/today'
import { toast } from '@/lib/toast'
import { useUndo } from '@/lib/undo'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import { holdLine } from '@/model/editor-readiness'
import { draftsVerb, type InboxCard } from '@/model/inbox'
import { paneState } from '@/model/inbox-pane'
import type { Fact } from '@/model/items'

// The person's own drafts card in the Inbox's pane (FR-139): the drafts they imported, or left for
// a while, that only they can see. One button publishes each where they may and sends the rest to
// their domains' owners, as the Context list's Publish does; more than a handful is asked first.
// A draft opens in the card's place, held in the address (&draft=<id>), so Back, a reload and the
// editor's own Back come back to it: "5 of 21" with J and K through the drafts, Publish (Enter),
// Edit, and Don't publish, which deletes it with Undo; after either the next draft opens. Esc or
// the bar's back arrow returns to the list as it was left, the draft's row focused and in view.

/** How the pane's bar moves while a draft is open: through the drafts, and back to their list. */
export type DraftsNav = {
  onStep: (d: 1 | -1) => void
  onBack: () => void
  /** "21 drafts": where the back arrow goes. */
  backLabel: string
  /** "5 of 21". */
  position: string
}

/** Where the list was left, by card: its scroll, and whether this tab opened the draft from it. */
const left = new Map<string, { scroll: number; fromList: boolean }>()

/** The pane's scrolling body around an element in it. */
const paneBody = (el: Element | null) => el?.closest<HTMLElement>('[data-slot=panel-body]')

/** What the pane shows for the card, framed by the Inbox's own panel. */
export default function DraftsReview({
  card,
  onFinished,
  frame,
}: {
  card: InboxCard
  /** The card is done: every draft on it went, or left the person's list. */
  onFinished: () => void
  frame: (body: React.ReactNode, foot: React.ReactNode, nav?: DraftsNav) => React.ReactNode
}) {
  const me = useMe()
  const domains = useDomains()
  const facts = useFacts()
  const online = useOnline()
  const undo = useUndo()
  const publishDrafts = usePublishDrafts()
  const { path, query } = useRoute()
  const [asking, setAsking] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const who = { name: me.name, admin: me.admin }
  // The drafts as the person's list has them now, oldest first. One Publish takes the first
  // PUBLISH_MAX of those that can go; the rest stay on the card for the next.
  const ids = card.drafts?.ids ?? []
  const rows = ids.flatMap((id) => facts.filter((f) => f.id === id && f.status === 'Draft'))
  const split = publishSplit(rows, who, domains)
  const held = new Map(split.plan.skipped.map((s) => [s.id, s.why]))
  const more = split.plan.next.length
  const reading = rows.find((f) => f.id === query.get('draft'))
  const listRef = React.useRef<HTMLUListElement>(null)
  // The draft last read: its row takes the focus when the list comes back.
  const lastRead = React.useRef<string | undefined>(undefined)
  const readingId = reading?.id

  // Back on the list: where it was left, with the last draft read in view and focused.
  React.useLayoutEffect(() => {
    if (readingId) {
      lastRead.current = readingId
      return
    }
    const list = listRef.current
    const id = lastRead.current
    if (!list || !id) return
    const body = paneBody(list)
    const was = left.get(card.id)
    if (body && was) body.scrollTop = was.scroll
    const row = list.querySelector<HTMLElement>(`[data-draft-row="${CSS.escape(id)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus({ preventScroll: true })
  }, [readingId, card.id])

  const publish = async () => {
    setBusy(true)
    try {
      const done = await publishDrafts(rows, 'Published from the Inbox.')
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
      undo.offer(line, done.undo, {
        description: publishedWhen(done.published.length, done.sent.length),
      })
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

  if (reading)
    return (
      <DraftReader
        fact={reading}
        rows={rows}
        cardId={card.id}
        onFinished={onFinished}
        frame={frame}
      />
    )

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

  // A row opens its draft in the card's place; by the keyboard, the focus goes to its decision.
  const opening = (e: React.MouseEvent) => {
    left.set(card.id, { scroll: paneBody(listRef.current)?.scrollTop ?? 0, fromList: true })
    focusReader = e.detail === 0
  }
  const body = (
    <>
      <PaneHead
        state={paneState(card)}
        domain={card.domain || undefined}
        title={card.title}
        summary={card.line}
      />
      <div className="max-w-2xl px-4 pb-6 @md:px-7">
        <ul ref={listRef} aria-label="Your drafts" className="rounded-md border text-sm">
          {rows.map((f) => (
            <li key={f.id} className="border-b last:border-b-0">
              <a
                href={href(path, { ...Object.fromEntries(query), draft: f.id })}
                data-draft-row={f.id}
                onClick={opening}
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
        drafts={split.plan.act}
        send={split.sending}
        next={more}
        skipped={split.plan.skipped}
        from="card"
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

/** Whether the draft about to open was opened by the keyboard: its decision then takes the focus. */
let focusReader = false

/** One draft, read in the card's place, with its decisions; after one, the next draft opens. */
function DraftReader({
  fact: listed,
  rows,
  cardId,
  onFinished,
  frame,
}: {
  fact: Fact
  rows: Fact[]
  cardId: string
  onFinished: () => void
  frame: (body: React.ReactNode, foot: React.ReactNode, nav?: DraftsNav) => React.ReactNode
}) {
  const me = useMe()
  const domains = useDomains()
  const online = useOnline()
  const undo = useUndo()
  const write = useWrite()
  const publishDrafts = usePublishDrafts()
  // The draft's own read has its whole text and source; its row shows while it loads.
  const fact = useQuery(itemPageQuery(listed.id)).data?.item ?? listed
  const at = rows.findIndex((f) => f.id === fact.id)
  const top = React.useRef<HTMLDivElement>(null)
  const who = { name: me.name, admin: me.admin }
  const ready = draftReadiness(fact, domains)
  const owner = publishesNow(fact, who, domains)
  const hold = holdLine(ready)

  const stepTo = (id: string) => void changeQuery({ draft: id }, { replace: true })
  const step = (d: 1 | -1) => {
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + d))]
    if (next && next.id !== fact.id) stepTo(next.id)
  }
  // Back to the list: the address this tab came from when it opened the draft there, else the
  // list in this one's place.
  const toList = () => {
    if (left.get(cardId)?.fromList) {
      left.set(cardId, { ...left.get(cardId)!, fromList: false })
      window.history.back()
    } else void changeQuery({ draft: undefined }, { replace: true })
  }
  // A decision moves on at once, as the Inbox's cards do: the next draft opens, else the one
  // before; with none left the card is done. The save runs behind it, and says so if it fails.
  const moveOn = () => {
    const next = rows[at + 1] ?? rows[at - 1]
    if (next) stepTo(next.id)
    else onFinished()
  }

  // Opening it counts as reading it; each opens at its top, and by the keyboard on its decision.
  React.useEffect(() => {
    // Not marked as read, it is marked the next time it opens: nothing to say.
    write('markViewed', { id: fact.id }).catch(() => undefined)
    const body = paneBody(top.current)
    if (body) body.scrollTop = 0
    if (focusReader)
      body?.closest('section')?.querySelector<HTMLButtonElement>('button[data-primary]')?.focus()
    focusReader = false
    // Once per draft opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fact.id])

  // J and K step through the drafts and Esc goes back to their list, before the Inbox's own keys
  // (which step its cards) hear them. A dialog or a menu keeps its own Esc.
  const onKey = React.useEffectEvent((e: KeyboardEvent) => {
    if (!pageKey(e) || e.defaultPrevented) return
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      step(e.key === 'j' ? 1 : -1)
    }
    const t = e.target as Element
    if (e.key === 'Escape' && !t.closest?.('[role=dialog],[role=menu],[role=listbox]')) {
      e.preventDefault()
      toList()
    }
  })
  React.useEffect(() => {
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const publish = async () => {
    moveOn()
    try {
      const done = await publishDrafts([fact], 'Published from the Inbox.')
      if (!done.published.length && !done.sent.length) {
        toast(owner ? "Couldn't publish it" : "Couldn't send it", {
          description: done.skipped[0]?.reason ?? 'Try again.',
        })
        return
      }
      undo.offer(done.sent.length ? `Sent to the owners of ${done.to}` : 'Published', done.undo, {
        description: publishedWhen(done.published.length, done.sent.length),
      })
    } catch (error) {
      toast(owner ? "Couldn't publish it" : "Couldn't send it", {
        description: toApiError(error).message,
      })
    }
  }
  // Don't publish: a draft nobody published is deleted, at once for one, with Undo for a while.
  const remove = async () => {
    moveOn()
    try {
      const deleted = await write('applyBulk', {
        action: 'delete',
        patches: {},
        remove: [fact.id],
        entry: {
          id: `log-deleted-${fact.id}`,
          on: today(),
          who: me.name,
          what: 'deleted',
          summary: 'Deleted: a draft nobody published.',
          items: [{ id: fact.id, title: fact.title, domain: fact.domain }],
        },
      })
      undo.offer('Deleted 1 draft', deleted.undo, {
        description: (held) => `You can undo it for ${held}; then it is gone for good.`,
      })
    } catch (error) {
      toast("Couldn't delete it", { description: toApiError(error).message })
    }
  }

  const edit = `/context/${fact.id}/${owner ? 'edit' : 'suggest'}`
  const verb = owner ? 'Publish' : 'Send'
  const body = (
    <div ref={top} className="flex flex-col gap-5 px-4 py-6 @md:px-7">
      {hold && <PeekAttention icon={TriangleAlertIcon}>{hold}</PeekAttention>}
      <ItemDocument fact={fact} heading="h2" />
    </div>
  )
  const foot = (
    <PaneFoot
      follows={
        !online
          ? "Offline: changes wait until you're back."
          : hold
            ? 'It needs a fix before it can go'
            : rows.length > 1
              ? 'Then the next draft opens'
              : undefined
      }
    >
      <Button variant="outline" size="lg" disabled={!online} onClick={() => void remove()}>
        Don&apos;t publish
      </Button>
      {hold ? (
        <>
          <Button variant="outline" size="lg" disabled>
            {verb}
          </Button>
          <PrimaryAction onClick={() => navigate(edit)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </PrimaryAction>
        </>
      ) : (
        <>
          <Button variant="outline" size="lg" nativeButton={false} render={<a href={href(edit)} />}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
          <PrimaryAction disabled={!online} onClick={() => void publish()}>
            {verb}
          </PrimaryAction>
        </>
      )}
    </PaneFoot>
  )
  return frame(body, foot, {
    onStep: step,
    onBack: toList,
    backLabel: count(rows.length, 'draft'),
    position: `${at + 1} of ${rows.length}`,
  })
}
