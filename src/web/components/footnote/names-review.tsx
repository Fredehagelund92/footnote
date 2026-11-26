import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import type { SourceNameRead, WaitingValue } from '@contract/inbox'
import { toApiError } from '@/api/errors'
import { namesQuery, queryKeys, useWrite } from '@/api/queries'
import { Domain, Fold, PaneFoot, PaneHead, PrimaryAction } from '@/components/footnote/inbox-pane'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ListSkeleton, Loadable } from '@/components/footnote/load-state'
import { SourceText } from '@/components/footnote/source-text'
import { FamiliesFound, type FoundCounts } from '@/components/footnote/families-found'
import { TextSwitch } from '@/components/footnote/switches'
import { FamilyGlyph } from '@/components/footnote/type-glyph'
import { FoldTrigger } from '@/components/footnote/fold'
import { useOnline } from '@/lib/send'
import { familyFoundKinds, foundKindWords } from '@domain/family-found'
import { asSuggested } from '@domain/suggested-names'
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

/** How a family was found, in the tool's name (D1): "declared in dbt", "found from a rate in dbt". */
const foundWords = (name: SourceNameRead) =>
  !name.family || name.family.found === 'names'
    ? null
    : name.family.found === 'declared'
      ? `declared in ${name.tool}`
      : `found ${foundKindWords(name.family.found, name.tool)} in ${name.tool}`

/** A family the names alone suggest, which waits for the owner to say it is one (D1). */
const looksAlike = (name: SourceNameRead) =>
  name.family?.found === 'names' && name.linked.length === 0

/**
 * A family's name: with `onOpen`, a button that opens its panel, which shows what it would mean,
 * its values and who owns it, with Publish as a family and Keep them separate (F4). `said` is what
 * the button shows when that is not the family's name, so the name it is heard by holds it.
 */
function FamilyName({
  name,
  said = name.name,
  children,
  onOpen,
}: {
  name: SourceNameRead
  said?: string
  children: React.ReactNode
  onOpen?: (key: string) => void
}) {
  if (!onOpen || !name.family)
    return <span className="font-medium text-foreground">{children}</span>
  return (
    <button
      type="button"
      className="text-left font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`Look at the family ${said}`}
      data-row-open={name.key}
      onClick={() => onOpen(name.key)}
    >
      {children}
    </button>
  )
}

/**
 * A name that is ready: what it is, and the source's own words for it. A family says what it holds
 * and is published with one press, its variants with it; they are never listed here. `grouped`
 * rows sit under how their family was found, so they leave that out. The buttons keep a column of
 * their own, so every row is as tall as its words.
 */
function ReadyRow({
  name,
  busy,
  grouped = false,
  onLeaveOut,
  onPublish,
  onOpen,
}: {
  name: SourceNameRead
  busy: boolean
  grouped?: boolean
  onLeaveOut: () => void
  onPublish: () => void
  onOpen?: (key: string) => void
}) {
  return (
    <li className="grid min-w-0 grid-cols-(--cols-trail-auto) items-center gap-x-3 py-2">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <FamilyName name={name} onOpen={onOpen}>
            {name.name}
          </FamilyName>
          <span className="text-xs text-muted-foreground">
            {name.family
              ? grouped
                ? familyWords(name.family)
                : [`Family · ${familyWords(name.family)}`, foundWords(name)]
                    .filter(Boolean)
                    .join(' · ')
              : kindWord[name.kind]}
          </span>
          {name.linked.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {name.family ? 'Adds variants' : 'Adds another view'}
            </span>
          )}
          {name.areaId && <Domain id={name.areaId} />}
        </span>
        {name.description && (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            <SourceText text={name.description} />
          </span>
        )}
      </span>
      <span className="flex items-center gap-1">
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
    </li>
  )
}

/**
 * A value someone added to a dimension in Definitions (values without figures): its dimension,
 * its other names, how the data writes it and who added it, with Publish and Leave out.
 */
function ValueRow({
  value,
  busy,
  onPublish,
  onLeaveOut,
}: {
  value: WaitingValue
  busy: boolean
  onPublish: () => void
  onLeaveOut: () => void
}) {
  const said = [
    `Value of ${value.dimension.name}`,
    value.aliases.length > 0 && `also ${value.aliases.join(', ')}`,
    value.writtenAs.length > 0 && `the data writes ${value.writtenAs.join(', ')}`,
    value.by.name && `added by ${value.by.name}`,
  ].filter(Boolean)
  return (
    <li className="grid min-w-0 grid-cols-(--cols-trail-auto) items-center gap-x-3 py-2">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{value.name}</span>
        <span className="text-xs text-muted-foreground">{said.join(' · ')}</span>
        {value.areaId && <Domain id={value.areaId} />}
      </span>
      <span className="flex items-center gap-1">
        <Button variant="outline" disabled={busy} onClick={onPublish}>
          Publish
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onLeaveOut}>
          Leave out
        </Button>
      </span>
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
  onOpen,
}: {
  name: SourceNameRead
  busy: boolean
  problem: string | undefined
  onAccept: (chosen: string) => void
  onLeaveOut?: () => void
  onOpen?: (key: string) => void
}) {
  const [chosen, setChosen] = React.useState(name.name)
  const id = React.useId()
  const onlyVariants =
    name.family !== null &&
    name.flags.length > 0 &&
    name.flags.every((flag) => flag.code === 'variants')
  // The name the tool has for it, small after the plain name, so two rows of one name can be
  // told apart; a family says what it holds.
  const member = name.family
    ? familyWords(name.family)
    : memberOf(name.definitionRefs[0] ?? name.key)
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t py-3 first:border-t-0">
      <label htmlFor={id} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-sm">
            <FamilyName name={name} onOpen={onOpen}>
              {name.name}
            </FamilyName>
          </span>
          <span>{kindWord[name.kind]}</span>
          <span className={cn(!name.family && 'font-mono')}>{member}</span>
        </span>
        {name.flags.map((flag) => flag.message).join(' ')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          value={chosen}
          readOnly={name.linked.length > 0 || onlyVariants}
          aria-invalid={problem ? true : undefined}
          aria-label={`Name for ${member}`}
          className="min-w-48 flex-1"
          onChange={(e) => setChosen(e.target.value)}
        />
        {!onlyVariants && (
          <Button variant="outline" disabled={busy} onClick={() => onAccept(chosen)}>
            Publish
          </Button>
        )}
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
 * Names that look alike (D1): one name in other currencies, which nothing in the tool says are one
 * family. The owner publishes them as one family, under the name to keep or change, or apart, each
 * by its own name, or leaves them out. Never published by Publish all.
 */
function LookAlikeRow({
  name,
  busy,
  problem,
  onFamily,
  onApart,
  onLeaveOut,
  onOpen,
}: {
  name: SourceNameRead
  busy: boolean
  problem: string | undefined
  onFamily: (chosen: string) => void
  onApart: () => void
  onLeaveOut?: () => void
  onOpen?: (key: string) => void
}) {
  const [chosen, setChosen] = React.useState(name.name)
  const id = React.useId()
  const names = name.family?.names ?? []
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t py-3 first:border-t-0">
      <label htmlFor={id} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-sm">
            <FamilyName name={name} said={names.join(', ')} onOpen={onOpen}>
              {names.join(', ')}
            </FamilyName>
          </span>
          <span>{names.length.toLocaleString('en-GB')} metrics</span>
        </span>
        {name.flags.map((flag) => flag.message).join(' ')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          value={chosen}
          aria-invalid={problem ? true : undefined}
          aria-label={`Name for the family of ${names.join(', ')}`}
          className="min-w-48 flex-1"
          onChange={(e) => setChosen(e.target.value)}
        />
        <Button variant="outline" disabled={busy} onClick={() => onFamily(chosen)}>
          Publish as a family
        </Button>
        <Button variant="outline" disabled={busy} onClick={onApart}>
          Keep them separate
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

/** Which part of the card shows: the families to group, or the names of single definitions. */
export type NamesShow = 'families' | 'names'

const n = (x: number) => x.toLocaleString('en-GB')
const familiesSaid = (x: number) => (x === 1 ? '1 family' : `${n(x)} families`)
const namesSaid = (x: number) => (x === 1 ? '1 name' : `${n(x)} names`)

/** A family waiting on a name: every flag says its name is taken, shared or can't be used. */
const nameFlags = new Set(['taken', 'same_name', 'bad_name'])

/**
 * The families ready to publish, by how each was found (D1, D6), in the order of trust: one row a
 * kind, which says how many and names a few, and opens to the families themselves.
 */
function ReadyGroups({
  ready,
  busy,
  onLeaveOut,
  onPublish,
  onOpen,
}: {
  ready: readonly SourceNameRead[]
  busy: boolean
  onLeaveOut: (name: SourceNameRead) => void
  onPublish: (name: SourceNameRead) => void
  onOpen?: (key: string) => void
}) {
  // Open at first while they are few; a model of hundreds starts folded, a row a kind.
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() =>
    ready.length <= OPEN_READY ? new Set(familyFoundKinds) : new Set(),
  )
  const groups = familyFoundKinds.flatMap((kind) => {
    const of = ready.filter((name) => name.family?.found === kind)
    return of.length ? [{ kind, of }] : []
  })
  return (
    <ul className="flex flex-col">
      {groups.map(({ kind, of }) => {
        const said = foundKindWords(kind, of[0]!.tool)
        const title =
          kind === 'names'
            ? 'Look alike, published as one family'
            : `${said.charAt(0).toUpperCase()}${said.slice(1)}`
        const by = [...new Set(of.map((name) => familyBy({ by: name.family!.by, variants: [] })))]
        const named = of.slice(0, 3).map((name) => name.name)
        const more = of.length - named.length
        const shown = open.has(kind)
        const id = `names-ready-${kind}`
        return (
          <li key={kind} className="border-t first:border-t-0">
            <h4>
              <FoldTrigger
                label={title}
                summary={`${familiesSaid(of.length)}${by.length === 1 ? ` ${by[0]}` : ''}: ${named.join(', ')}${more > 0 ? ` and ${n(more)} more` : ''}`}
                lead={<FamilyGlyph className="size-4" />}
                trail={<Count n={of.length} />}
                expanded={shown}
                aria-controls={id}
                onClick={() =>
                  setOpen((was) => {
                    const next = new Set(was)
                    if (next.has(kind)) next.delete(kind)
                    else next.add(kind)
                    return next
                  })
                }
              />
            </h4>
            {shown && (
              <ul id={id} className="mb-2 ml-6 divide-y divide-border">
                {of.map((name) => (
                  <ReadyRow
                    key={name.key}
                    name={name}
                    busy={busy}
                    grouped
                    onLeaveOut={() => onLeaveOut(name)}
                    onPublish={() => onPublish(name)}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A section's count beside its heading, quiet; a screen reader hears it as part of the name. */
const Count = ({ n: count }: { n: number }) => (
  <span className="text-xs font-normal text-muted-foreground tabular-nums">{n(count)}</span>
)

/** How many ready families open at once, each kind's list shown; past it they start folded. */
const OPEN_READY = 8

/** The part asked for, unless it has nothing open and the other has. */
function partWithOpen(part: NamesShow, families: number, singles: number): NamesShow {
  if (part === 'families' && !families && singles) return 'names'
  if (part === 'names' && !singles && families) return 'families'
  return part
}

/**
 * The review. `frame` draws its body and its foot in the Inbox's pane or the setup checklist's
 * dialog; `onFinished` runs once nothing is left to publish. Families and names are two parts
 * (D1): Families groups near-identical metrics, by how each family was found; Names names the
 * single metrics and dimensions. `show` picks one, as the Inbox's address may (?show=families).
 */
export default function NamesReview({
  frame,
  onFinished,
  onOpenFamily,
  show: asked,
  onShow,
}: {
  frame: (body: React.ReactNode, foot: React.ReactNode) => React.ReactNode
  onFinished?: () => void
  /** Opens a family's panel, by its key; without it a family's name opens nothing. */
  onOpenFamily?: (key: string) => void
  show?: NamesShow
  onShow?: (show: NamesShow) => void
}) {
  const read = useQuery(namesQuery())
  const write = useWrite()
  const client = useQueryClient()
  const online = useOnline()
  const [busy, setBusy] = React.useState(false)
  const [problems, setProblems] = React.useState<Record<string, string>>({})
  const [all, setAll] = React.useState(false)
  const [picked, setPicked] = React.useState<NamesShow | undefined>(undefined)
  const names = read.data?.names ?? []
  const values = read.data?.values ?? []
  // The definitions integration's tool: one is on at a time (CON-120).
  const tool = names[0]?.tool ?? 'your definitions tool'
  const looking = names.filter((name) => name.state !== 'left_out')
  const families = names.filter((name) => name.family)
  const singles = names.filter((name) => !name.family)
  const familiesOpen = families.filter((name) => name.state !== 'left_out')
  const singlesOpen = singles.filter((name) => name.state !== 'left_out')
  // Two parts only when there is something in each; one part is just the list.
  const parts = families.length > 0 && singles.length > 0
  const show: NamesShow = !parts
    ? families.length
      ? 'families'
      : 'names'
    : partWithOpen(
        (onShow ? asked : (picked ?? asked)) ??
          (familiesOpen.length || !singlesOpen.length ? 'families' : 'names'),
        familiesOpen.length,
        singlesOpen.length,
      )
  const choose = (next: NamesShow) => {
    setPicked(next)
    setAll(false)
    onShow?.(next)
  }

  const decide = async (
    picks: { key: string; name?: string; apart?: true }[],
    leaveOut: string[],
    message: string,
    decided: { accept: string[]; leaveOut: string[] } = { accept: [], leaveOut: [] },
  ) => {
    if (!read.data) return
    setBusy(true)
    setProblems({})
    try {
      await write('decideNames', {
        revision: read.data.revision,
        accept: picks,
        leaveOut,
        values: decided,
      })
      toast(message)
      const open = names.filter(
        (name) =>
          name.state !== 'left_out' &&
          !leaveOut.includes(name.key) &&
          !picks.some((pick) => pick.key === name.key),
      )
      const still = values.filter(
        (value) => !decided.accept.includes(value.id) && !decided.leaveOut.includes(value.id),
      )
      if (!open.length && !still.length) onFinished?.()
    } catch (e) {
      const error = toApiError(e)
      const key = picks.length === 1 ? picks[0]!.key : undefined
      const edited = key && names.some((n) => n.key === key && n.state !== 'ready')
      // Only a refusal of the name goes under its box: a limit reached or a list that changed is
      // about no name, and is said once.
      if (key && edited && error.kind === 'invalid') setProblems({ [key]: error.message })
      else toast("Couldn't publish the names", { description: error.message })
      if (error.kind === 'conflict') await client.invalidateQueries({ queryKey: queryKeys.names })
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
  const leaveOut = (name: SourceNameRead) => decide([], [name.key], `${name.name} is left out`)
  const publishValues = (ids: string[], message: string) =>
    decide([], [], message, { accept: ids, leaveOut: [] })
  const leaveValueOut = (value: WaitingValue) =>
    decide([], [], `${value.name} is left out`, { accept: [], leaveOut: [value.id] })
  const apart = (name: SourceNameRead) =>
    decide(
      [{ key: name.key, apart: true }],
      [],
      `${n(name.family!.names.length)} metrics are published separately`,
    )

  if (!read.data)
    return frame(
      <Loadable what="the names" skeleton={<ListSkeleton rows={5} />} query={read}>
        {null}
      </Loadable>,
      null,
    )

  const list = show === 'families' ? families : singles
  const ready = list.filter((name) => name.state === 'ready')
  const waiting = list.filter((name) => name.state === 'flagged')
  const flagged = waiting.filter((name) => !looksAlike(name))
  const alike = waiting.filter(looksAlike)
  const left = list.filter((name) => name.state === 'left_out')
  // One title a project keeps in many semantic models flags every copy: they go out at one press.
  const suggested = show === 'names' ? asSuggested(flagged) : []
  const found = Object.fromEntries(
    familyFoundKinds.map((kind) => [
      kind,
      familiesOpen.filter((name) => name.family!.found === kind).length,
    ]),
  ) as FoundCounts
  const shown = all ? ready : ready.slice(0, FIRST_ROWS)
  const counts = {
    ready: names.filter((name) => name.state === 'ready').length,
    flagged: names.filter((name) => name.state === 'flagged').length,
    families: familiesOpen.length,
    values: values.length,
    tool,
  }
  const valuesSection = values.length > 0 && (
    <section aria-labelledby="names-values" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 id="names-values" className="font-medium">
          Values people added <Count n={values.length} />
        </h3>
        {values.length > 1 && (
          <Button
            variant="outline"
            disabled={busy || !online}
            onClick={() =>
              void publishValues(
                values.map((value) => value.id),
                `${n(values.length)} values are published`,
              )
            }
          >
            Publish {n(values.length)} values
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Added in Definitions. Once published, people can say an item is about one of them, and
        agents can name it.
      </p>
      <ul className="divide-y divide-border">
        {values.map((value) => (
          <ValueRow
            key={value.id}
            value={value}
            busy={busy || !online}
            onPublish={() => void publishValues([value.id], `${value.name} is published`)}
            onLeaveOut={() => void leaveValueOut(value)}
          />
        ))}
      </ul>
    </section>
  )
  const body = (
    <>
      <PaneHead
        state={{
          label: looking.length || !values.length ? 'New metrics and dimensions' : 'New values',
          icon: 'names',
          tone: 'neutral',
        }}
        title={namesWords(counts).title}
        summary={
          looking.length || !values.length
            ? `These metrics and dimensions were found in ${tool}. Publish them, and people can write context about them and agents can use them.${familiesOpen.length ? ' A family of near-identical metrics is published as one name, with its variants.' : ''}`
            : 'People added these values of a dimension in Definitions. Publish the ones that are right.'
        }
      />
      <div className="flex max-w-2xl flex-col gap-5 px-4 pb-6 text-sm @md:px-7">
        {valuesSection}
        {parts && (
          <TextSwitch
            label="Families or names"
            value={show}
            onChange={choose}
            className="-mt-1 border-b pb-2"
            options={[
              { value: 'families', label: 'Families', count: familiesOpen.length },
              { value: 'names', label: 'Names', count: singlesOpen.length },
            ]}
          />
        )}
        {show === 'families' && familiesOpen.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">
              Each family is published as one metric, with its variants.
              {onOpenFamily && ' Open one to see what it would mean.'}
            </p>
            <FamiliesFound found={found} tool={tool} as="line" />
          </div>
        )}
        {alike.length > 0 && (
          <section aria-labelledby="names-alike" className="flex flex-col gap-1">
            <h3 id="names-alike" className="font-medium">
              Look alike <Count n={alike.length} />
            </h3>
            <p className="text-xs text-muted-foreground">
              {alike.length === 1
                ? 'These metrics have one name in other currencies'
                : `${n(alike.length)} sets of metrics have one name in other currencies`}
              , and nothing in {tool} says they are one metric. Each waits for you.
            </p>
            <ul>
              {alike.map((name) => (
                <LookAlikeRow
                  key={name.key}
                  name={name}
                  busy={busy || !online}
                  problem={problems[name.key]}
                  onFamily={(chosen) => void acceptOne(name, chosen)}
                  onOpen={onOpenFamily}
                  onApart={() => void apart(name)}
                  onLeaveOut={() => void leaveOut(name)}
                />
              ))}
            </ul>
          </section>
        )}
        {flagged.length > 0 && (
          <section aria-labelledby="names-flagged" className="flex flex-col gap-1">
            <h3 id="names-flagged" className="font-medium">
              {show === 'families' &&
              flagged.every((name) => name.flags.every((flag) => nameFlags.has(flag.code)))
                ? 'Needs another name'
                : 'Look at these first'}{' '}
              <Count n={flagged.length} />
            </h3>
            <p className="text-xs text-muted-foreground">
              One word has one meaning here. Keep the name below, change it, or leave it out. A name
              that is published already keeps the one it has.
            </p>
            {suggested.length > 1 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
                <p className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">
                  {suggested.length === flagged.length ? 'These' : `${suggested.length} of these`}{' '}
                  share a name with another definition. Each can go out with the name shown, which
                  tells it apart.
                </p>
                <Button
                  variant="outline"
                  disabled={busy || !online}
                  onClick={() =>
                    void decide(
                      suggested.map((name) => ({ key: name.key })),
                      [],
                      `${suggested.length} names are published as suggested`,
                    )
                  }
                >
                  Publish these as suggested
                </Button>
              </div>
            )}
            <ul>
              {flagged.map((name) => (
                <FlaggedRow
                  key={name.key}
                  name={name}
                  busy={busy}
                  problem={problems[name.key]}
                  onAccept={(chosen) => void acceptOne(name, chosen)}
                  onOpen={onOpenFamily}
                  onLeaveOut={name.linked.length ? undefined : () => void leaveOut(name)}
                />
              ))}
            </ul>
          </section>
        )}
        {ready.length > 0 && (
          <section aria-labelledby="names-ready" className="flex flex-col gap-1">
            <h3 id="names-ready" className="font-medium">
              {show === 'families' ? 'Ready' : 'Ready to publish'} <Count n={ready.length} />
            </h3>
            {show === 'families' ? (
              <ReadyGroups
                ready={ready}
                busy={busy}
                onLeaveOut={(name) => void leaveOut(name)}
                onPublish={(name) => void acceptOne(name, name.name)}
                onOpen={onOpenFamily}
              />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {shown.map((name) => (
                    <ReadyRow
                      key={name.key}
                      name={name}
                      busy={busy}
                      onLeaveOut={() => void leaveOut(name)}
                      onPublish={() => void acceptOne(name, name.name)}
                      onOpen={onOpenFamily}
                    />
                  ))}
                </ul>
                {shown.length < ready.length && (
                  <Button variant="ghost" className="w-fit" onClick={() => setAll(true)}>
                    Show all {ready.length}
                  </Button>
                )}
              </>
            )}
          </section>
        )}
        {left.length > 0 && (
          <Fold
            title="Left out"
            summary={
              show === 'families'
                ? `${familiesSaid(left.length)}, kept off the list until you publish ${left.length === 1 ? 'it' : 'them'}`
                : `${left.length} ${left.length === 1 ? 'name' : 'names'}: dates and ids stay out by themselves`
            }
          >
            <ul className="divide-y divide-border">
              {left.map((name) =>
                looksAlike(name) ? (
                  <LookAlikeRow
                    key={name.key}
                    name={name}
                    busy={busy || !online}
                    problem={problems[name.key]}
                    onFamily={(chosen) => void acceptOne(name, chosen)}
                    onOpen={onOpenFamily}
                    onApart={() => void apart(name)}
                  />
                ) : (
                  <FlaggedRow
                    key={name.key}
                    name={name}
                    busy={busy}
                    problem={problems[name.key]}
                    onAccept={(chosen) => void acceptOne(name, chosen)}
                    onOpen={onOpenFamily}
                  />
                ),
              )}
            </ul>
          </Fold>
        )}
      </div>
    </>
  )
  // What stays on the card once this part's ready ones go: what waits here, and the other part.
  const staying = looking.length - ready.length
  const count = show === 'families' ? familiesSaid(ready.length) : namesSaid(ready.length)
  const goes = ready.length === 1 ? 'is' : 'are'
  const foot =
    ready.length > 0 ? (
      <PaneFoot
        follows={
          online
            ? `${count} ${goes} published at once. ${
                staying
                  ? `The other ${n(staying)} ${staying === 1 ? 'stays' : 'stay'} here.`
                  : 'Nothing else waits.'
              }`
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
          {parts || show === 'families' ? `Publish ${count}` : 'Publish all'}
        </PrimaryAction>
      </PaneFoot>
    ) : null
  return frame(body, foot)
}

/** The names a read made, over the setup checklist: the same review as the Inbox's card. */
export function NamesDialog({ onClose, show }: { onClose: () => void; show?: NamesShow }) {
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
          show={show}
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
