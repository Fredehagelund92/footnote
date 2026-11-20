import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SourceNameRead } from '@contract/inbox'
import { toApiError } from '@/api/errors'
import { namesQuery, queryKeys, useWrite } from '@/api/queries'
import { Domain, Fold, PaneFoot, PaneHead, PrimaryAction } from '@/components/footnote/inbox-pane'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ListSkeleton, Loadable } from '@/components/footnote/load-state'
import { useOnline } from '@/lib/send'
import { memberOf } from '@domain/vocabulary'
import { familyBy } from '@/lib/definitions'
import { cn } from '@/lib/utils'
import { namesWords } from '@/model/inbox'

// The one card that makes a source's definitions usable (FR-141): the names a read made, what
// Publish all takes, the ones an owner looks at first because they would give a word a second
// meaning (FR-138), and what stays out. Loaded when a card needs it, never with the Inbox.

/** How many ready names show before Show all: a model can have thousands. */
const FIRST_ROWS = 40

const kindWord = { metric: 'Metric', dimension: 'Dimension', metric_group: 'Family' } as const

/** What a family holds, in words: "250 variants by Currency and Channel" (FR-142). */
const familyWords = (family: NonNullable<SourceNameRead['family']>) =>
  `${family.variants.toLocaleString('en-GB')} ${family.variants === 1 ? 'variant' : 'variants'} ${familyBy({ by: family.by, variants: [] })}`

/**
 * A name that is ready: what it is, and the source's own words for it. A family says what it holds
 * and is published with one press, its variants with it; they are never listed here.
 */
function ReadyRow({
  name,
  busy,
  onLeaveOut,
  onPublish,
}: {
  name: SourceNameRead
  busy: boolean
  onLeaveOut: () => void
  onPublish: () => void
}) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-2">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{name.name}</span>
        <span className="text-xs text-muted-foreground">
          {name.family ? `Family · ${familyWords(name.family)}` : kindWord[name.kind]}
        </span>
        {name.linked.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {name.family ? 'Adds variants' : 'Adds another view'}
          </span>
        )}
        {name.areaId && <Domain id={name.areaId} />}
        <span className="ml-auto flex items-center gap-1">
          {name.family && (
            <Button variant="outline" disabled={busy} onClick={onPublish}>
              Publish
            </Button>
          )}
          {name.linked.length === 0 && (
            <Button variant="ghost" disabled={busy} onClick={onLeaveOut}>
              Leave out
            </Button>
          )}
        </span>
      </span>
      {name.description && (
        <span className="line-clamp-1 text-xs text-muted-foreground">{name.description}</span>
      )}
    </li>
  )
}

/** A name with an editor: why it waits, the name to keep or change, and its decisions. */
function FlaggedRow({
  name,
  busy,
  problem,
  onAccept,
  onLeaveOut,
}: {
  name: SourceNameRead
  busy: boolean
  problem: string | undefined
  onAccept: (chosen: string) => void
  onLeaveOut?: () => void
}) {
  const [chosen, setChosen] = React.useState(name.name)
  const id = React.useId()
  // The name the tool has for it, small after the plain name, so two rows of one name can be
  // told apart; a family says what it holds.
  const member = name.family
    ? familyWords(name.family)
    : memberOf(name.definitionRefs[0] ?? name.key)
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t py-3 first:border-t-0">
      <label htmlFor={id} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-foreground">{name.name}</span>
          <span>{kindWord[name.kind]}</span>
          <span className={cn(!name.family && 'font-mono')}>{member}</span>
        </span>
        {name.flags.map((flag) => flag.message).join(' ')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          value={chosen}
          readOnly={name.linked.length > 0}
          aria-invalid={problem ? true : undefined}
          aria-label={`Name for ${member}`}
          className="min-w-48 flex-1"
          onChange={(e) => setChosen(e.target.value)}
        />
        <Button variant="outline" disabled={busy} onClick={() => onAccept(chosen)}>
          Publish
        </Button>
        {onLeaveOut && (
          <Button variant="ghost" disabled={busy} onClick={onLeaveOut}>
            Leave out
          </Button>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </li>
  )
}

/**
 * The review. `frame` draws its body and its foot in the Inbox's pane or the setup checklist's
 * dialog; `onFinished` runs once nothing is left to publish.
 */
export default function NamesReview({
  frame,
  onFinished,
}: {
  frame: (body: React.ReactNode, foot: React.ReactNode) => React.ReactNode
  onFinished?: () => void
}) {
  const read = useQuery(namesQuery())
  const write = useWrite()
  const client = useQueryClient()
  const online = useOnline()
  const [busy, setBusy] = React.useState(false)
  const [problems, setProblems] = React.useState<Record<string, string>>({})
  const [all, setAll] = React.useState(false)
  const names = read.data?.names ?? []
  const ready = names.filter((name) => name.state === 'ready')
  const flagged = names.filter((name) => name.state === 'flagged')
  const left = names.filter((name) => name.state === 'left_out')
  const tools = [...new Set(names.map((name) => name.tool))].sort()
  const families = names.filter((name) => name.family && name.state !== 'left_out').length

  const decide = async (
    picks: { key: string; name?: string }[],
    leaveOut: string[],
    message: string,
  ) => {
    if (!read.data) return
    setBusy(true)
    setProblems({})
    try {
      await write('decideNames', { revision: read.data.revision, accept: picks, leaveOut })
      toast(message)
      const open = names.filter(
        (name) =>
          name.state !== 'left_out' &&
          !leaveOut.includes(name.key) &&
          !picks.some((pick) => pick.key === name.key),
      )
      if (!open.length) onFinished?.()
    } catch (e) {
      const error = toApiError(e)
      const key = picks.length === 1 ? picks[0]!.key : undefined
      const edited = key && names.some((n) => n.key === key && n.state !== 'ready')
      if (key && edited) setProblems({ [key]: error.message })
      else toast("Couldn't publish the names", { description: error.message })
      await client.invalidateQueries({ queryKey: queryKeys.names })
    } finally {
      setBusy(false)
    }
  }
  const acceptOne = (name: SourceNameRead, chosen: string) =>
    decide(
      [{ key: name.key, ...(chosen === name.name ? {} : { name: chosen }) }],
      [],
      `${chosen} is published`,
    )

  if (!read.data)
    return frame(
      <Loadable what="the names" skeleton={<ListSkeleton rows={5} />} query={read}>
        {null}
      </Loadable>,
      null,
    )
  const shown = all ? ready : ready.slice(0, FIRST_ROWS)
  const body = (
    <>
      <PaneHead
        state={{ label: 'New metrics and dimensions', icon: 'names', tone: 'neutral' }}
        title={namesWords({ ready: ready.length, flagged: flagged.length, tools }).title}
        summary={`These metrics and dimensions were found in ${tools.length ? tools.join(', ') : 'your definitions tool'}. Publish them, and people can write context about them and agents can use them.${families ? ` ${families === 1 ? 'One is a family' : `${families} are families`} of near-identical metrics: each is published as one name, with its variants.` : ''}`}
      />
      <div className="flex max-w-2xl flex-col gap-5 px-4 pb-6 text-sm @md:px-7">
        {flagged.length > 0 && (
          <section aria-labelledby="names-flagged" className="flex flex-col gap-1">
            <h3 id="names-flagged" className="font-medium">
              Look at these first
            </h3>
            <p className="text-xs text-muted-foreground">
              One word has one meaning here. Keep the name below, change it, or leave it out. A name
              that is published already keeps the one it has.
            </p>
            <ul>
              {flagged.map((name) => (
                <FlaggedRow
                  key={name.key}
                  name={name}
                  busy={busy}
                  problem={problems[name.key]}
                  onAccept={(chosen) => void acceptOne(name, chosen)}
                  onLeaveOut={
                    name.linked.length
                      ? undefined
                      : () => void decide([], [name.key], `${name.name} is left out`)
                  }
                />
              ))}
            </ul>
          </section>
        )}
        {ready.length > 0 && (
          <section aria-labelledby="names-ready" className="flex flex-col gap-1">
            <h3 id="names-ready" className="font-medium">
              Ready to publish
            </h3>
            <ul className="divide-y divide-border">
              {shown.map((name) => (
                <ReadyRow
                  key={name.key}
                  name={name}
                  busy={busy}
                  onLeaveOut={() => void decide([], [name.key], `${name.name} is left out`)}
                  onPublish={() => void acceptOne(name, name.name)}
                />
              ))}
            </ul>
            {shown.length < ready.length && (
              <Button variant="ghost" className="w-fit" onClick={() => setAll(true)}>
                Show all {ready.length}
              </Button>
            )}
          </section>
        )}
        {left.length > 0 && (
          <Fold
            title="Left out"
            summary={`${left.length} ${left.length === 1 ? 'name' : 'names'}: dates and ids stay out by themselves`}
          >
            <ul className="divide-y divide-border">
              {left.map((name) => (
                <FlaggedRow
                  key={name.key}
                  name={name}
                  busy={busy}
                  problem={problems[name.key]}
                  onAccept={(chosen) => void acceptOne(name, chosen)}
                />
              ))}
            </ul>
          </Fold>
        )}
      </div>
    </>
  )
  const count = ready.length === 1 ? '1 name' : `${ready.length} names`
  const foot =
    ready.length > 0 ? (
      <PaneFoot
        follows={
          online
            ? flagged.length
              ? `${count} ${ready.length === 1 ? 'goes' : 'go'} out at once. The other ${flagged.length} ${flagged.length === 1 ? 'stays' : 'stay'} here.`
              : `${count} ${ready.length === 1 ? 'goes' : 'go'} out at once, for people and agents.`
            : "Offline: changes wait until you're back."
        }
      >
        <PrimaryAction
          disabled={busy || !online}
          onClick={() =>
            void decide(
              ready.map((name) => ({ key: name.key })),
              [],
              `${count} ${ready.length === 1 ? 'is' : 'are'} published`,
            )
          }
        >
          Publish all
        </PrimaryAction>
      </PaneFoot>
    ) : null
  return frame(body, foot)
}

/** The names a read made, over the setup checklist: the same review as the Inbox's card. */
export function NamesDialog({ onClose }: { onClose: () => void }) {
  const popup = React.useRef<HTMLDivElement>(null)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={popup}
        // Focus starts on Publish all, so the Enter its key shows publishes every name: on the first
        // row's Leave out, Enter left a name out.
        initialFocus={() =>
          popup.current?.querySelector<HTMLElement>('button[data-primary]') ?? true
        }
        className="flex max-h-screen-inset flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">The names from your definitions</DialogTitle>
        <NamesReview
          onFinished={onClose}
          frame={(body, foot) => (
            <>
              <div className="@container min-h-0 flex-1 overflow-y-auto">{body}</div>
              {foot && <div className="@container border-t">{foot}</div>}
            </>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
