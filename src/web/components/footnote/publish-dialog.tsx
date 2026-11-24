import * as React from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { kindIcons } from '@/components/footnote/kind-icons'
import { DomainDot } from '@/components/footnote/tag-chip'
import { count, leftOutLine, PUBLISH_MAX, type Skip } from '@/lib/bulk'
import { useDomains } from '@/lib/workspace'
import { kindLabel, type Fact, type Kind } from '@/model/items'

// The one question before many drafts are published at once, summary first: how many go, and past
// one batch which ones (the first 50 as the list shows them) and how many wait for the next press;
// which domains and kinds they are; a few titles with the rest one click away; which go to other
// domains' owners as suggestions; and in one quiet line what else was ticked and stays as it is.
// Publishing is no deletion, so nothing here is red; Cancel still has the focus, so a slip of
// Enter sends nothing.

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The drafts this Publish takes, in the list's order: published at once or sent to owners. */
  drafts: Fact[]
  /** Which of them go to their domain's owners as suggestions. */
  send: Fact[]
  /** How many drafts past the batch wait for the next Publish. */
  next: number
  /** What else was there that this leaves alone, and why. */
  skipped: Skip[]
  /** Where the drafts were picked: ticked in a list, or the Inbox's drafts card. */
  from?: 'ticked' | 'card'
  onPublish: () => void
}

/** The titles shown before Show all. */
const PREVIEW = 4

/** "Publish 21 drafts", "Suggest 3 drafts": the question and its button say the same. */
function publishVerb(publish: number, send: number) {
  return publish ? `Publish ${count(publish + send, 'draft')}` : `Suggest ${count(send, 'draft')}`
}

/** What the drafts for other domains' owners do: "3 of them go to the owners of Marketing ...". */
function sendLine(n: number, domains: string) {
  const one = n === 1
  return `${one ? '1 of them goes' : `${n} of them go`} to the owners of ${domains} as ${one ? 'a suggestion' : 'suggestions'}: agents get ${one ? 'it' : 'those'} once an owner publishes ${one ? 'it' : 'them'}.`
}

/** "You ticked 54 drafts. One Publish takes the first 50 ...": the batch, said before it goes. */
function batchLine(now: number, next: number, from: 'ticked' | 'card') {
  const all = (now + next).toLocaleString('en-GB')
  const rest = next.toLocaleString('en-GB')
  const stay = from === 'card' ? 'on the card' : 'ticked'
  return `${from === 'card' ? `${all} drafts are ready` : `You ticked ${all} drafts`}. One Publish takes the first ${PUBLISH_MAX} as the list shows them; the other ${rest} ${next === 1 ? 'stays' : 'stay'} ${stay} for the next one.`
}

/** "27 rules, 10 warnings, 9 events": the kinds in the batch, the most first. */
function kindsLine(drafts: Fact[]) {
  const counts = new Map<Kind, number>()
  for (const f of drafts) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => count(n, kindLabel[k].toLowerCase()))
    .join(', ')
}

export function PublishDialog({
  open,
  onOpenChange,
  drafts,
  send,
  next,
  skipped,
  from = 'ticked',
  onPublish,
}: Props) {
  const domains = useDomains()
  const cancel = React.useRef<HTMLButtonElement>(null)
  const [all, setAll] = React.useState(false)
  // Each time it opens it starts with the few titles.
  if (!open && all) setAll(false)
  const publish = drafts.length - send.length
  const verb = publishVerb(publish, send.length)
  const sendTo = [...new Set(send.map((f) => domains[f.domain]?.name))].join(' and ')
  const perDomain = new Map<Fact['domain'], number>()
  for (const f of drafts) perDomain.set(f.domain, (perDomain.get(f.domain) ?? 0) + 1)
  const byDomain = [...perDomain].sort((a, b) => b[1] - a[1])
  const left = leftOutLine(skipped, from)
  const shown = all ? drafts : drafts.slice(0, PREVIEW)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        initialFocus={cancel}
        className="max-h-screen-inset grid-cols-1 overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{verb}?</DialogTitle>
          <DialogDescription>
            {publish
              ? 'Agents get them from the next question. You can undo it for a few seconds.'
              : 'Agents get them once an owner publishes them.'}
          </DialogDescription>
        </DialogHeader>
        {next > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-band p-3">
            <p className="text-pretty">{batchLine(drafts.length, next, from)}</p>
            <BatchMeter now={drafts.length} next={next} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <ul aria-label="Domains" className="flex flex-wrap gap-x-4 gap-y-1.5">
            {byDomain.map(([d, n]) => (
              <li key={d} className="inline-flex items-center gap-1.5">
                <DomainDot id={d} />
                {domains[d]?.name}
                <span className="text-muted-foreground tabular-nums">
                  {n.toLocaleString('en-GB')}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{kindsLine(drafts)}</p>
        </div>
        <div className="overflow-hidden rounded-md border">
          <ul aria-label="To publish" className={all ? 'max-h-menu overflow-y-auto' : undefined}>
            {shown.map((f) => {
              const Icon = kindIcons[f.kind]
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0"
                >
                  <DomainDot id={f.domain} />
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </li>
              )
            })}
          </ul>
          {drafts.length > PREVIEW && (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll((a) => !a)}
              className="flex w-full items-center gap-1 border-t px-3 py-2 text-left font-medium text-primary outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              {all ? 'Show fewer' : `Show all ${drafts.length.toLocaleString('en-GB')}`}
              {all ? (
                <ChevronUpIcon aria-hidden className="size-4" />
              ) : (
                <ChevronDownIcon aria-hidden className="size-4" />
              )}
            </button>
          )}
        </div>
        {publish > 0 && send.length > 0 && (
          <p className="text-muted-foreground">{sendLine(send.length, sendTo)}</p>
        )}
        {left && <p className="text-muted-foreground">{left}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" ref={cancel} />}>Cancel</DialogClose>
          <Button
            onClick={() => {
              onOpenChange(false)
              onPublish()
            }}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The batch against the rest: a bar for the drafts that go now, a quiet one for the next press. */
function BatchMeter({ now, next }: { now: number; next: number }) {
  const share = (n: number) => `${(n / (now + next)) * 100}%`
  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-primary" style={{ width: share(now) }} />
        <div className="bg-muted-foreground/40" style={{ width: share(next) }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {now.toLocaleString('en-GB')}
          </span>{' '}
          now
        </span>
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {next.toLocaleString('en-GB')}
          </span>{' '}
          next Publish
        </span>
      </div>
    </div>
  )
}
