import * as React from 'react'
import { dayMonthYear, dayMonthYearLong } from '@/lib/dates'
import type { LoopItem, LoopRun, LoopTurn } from '@contract/answer'
import { dimensionHue, nounKindOf } from '@domain/ask-nouns'
import type { Domain } from '@/model/people'
import type { Kind, Status } from '@/model/items'
import type { AnswerActions, ReportLine, SomethingWrong } from '@/components/footnote/answer'
import type { AnswerFigure } from '@/components/footnote/answer-figure'
import type { LoopPartsOfAsk } from '@/components/footnote/loop-parts'
import { Marks, answerCode } from '@/components/footnote/source-text'
import { safeHref } from '@/lib/host'

/** What the loop's answer uses of Ask, handed to it by Ask (loop-parts.ts). */
export type LoopParts = LoopPartsOfAsk & {
  AnswerActions: typeof AnswerActions
  ReportLine: typeof ReportLine
  SomethingWrong: typeof SomethingWrong
  AnswerFigure: typeof AnswerFigure
}
export const PartsContext = React.createContext<LoopParts | null>(null)
/** Ask's parts, as the answer was given them. */
export function useParts(): LoopParts {
  const parts = React.useContext(PartsContext)
  if (!parts) throw new Error('A loop answer is drawn inside its parts.')
  return parts
}

/*
  The nouns of Ask's loop answers, one look each, the same in the words, the rows, the read line
  and the hover cards: a metric is a solid tinted chip with its sigma; a value of a dimension an
  outline in its dimension's own hue, with the icon its source's value type picks (a tag when it
  gives none); a dimension a dashed outline; a domain its own dot; a person their face and name;
  a day words with a dotted underline; a count bold with what it is out of; a context item a
  number where it is cited. Every hue comes from an id, never a name: no dimension, domain or
  person is special. Each opens its own card on hover, on keyboard focus and on a press; Escape
  closes it and focus comes back.
*/

type Noun = LoopTurn['nouns'][number]
export type Nouns = ReadonlyMap<string, Noun>

const key = (id: string) => id.slice(id.indexOf(':') + 1)

/** A domain of the workspace by a noun's id: its own id, or the service's `area_` one. */
function useDomainOf(id: string | null | undefined): Domain | undefined {
  const P = useParts()
  const domains = P.useDomains()
  if (!id) return undefined
  const k = key(id)
  return domains[k] ?? domains[k.replace(/^area_/, '')]
}

/**
 * A dimension's icon, or its value's: the dimension's own split, or the icon its source's value
 * type picks for a value: a day for time, a globe for places, else a tag.
 */
function DimensionGlyph({ dimension, type }: { dimension: boolean; type: string | null }) {
  const P = useParts()
  const cls = 'size-3 shrink-0'
  if (dimension) return <P.SplitIcon aria-hidden className={cls} />
  if (type === 'time') return <P.CalendarIcon aria-hidden className={cls} />
  if (type === 'geo') return <P.GlobeIcon aria-hidden className={cls} />
  return <P.TagIcon aria-hidden className={cls} />
}

/** A day as the answer says it: "4 August 2026"; `short` as a row says it: "4 Aug 2026". */
export function dayText(day: string, short = false) {
  return short ? dayMonthYear(day) : dayMonthYearLong(day)
}

// 24px tall at the least, so each is a target a pointer can hit (WCAG 2.5.8). The arrow, not the
// text cursor: a chip is a name with a card, and only one whose press opens something points.
const chip =
  'inline-flex min-h-6 max-w-full cursor-default items-center gap-1 rounded-sm px-1.5 py-px align-baseline text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * A trigger with its card: hover opens it after a moment, keyboard focus opens it at once, a press
 * keeps it open; Escape or a press outside closes it. A trigger that opens a quick view (`onOpen`)
 * closes its card on a press instead: the quick view shows the item, and on a phone it fills the
 * screen, where the card would sit on top of it.
 */
function HoverCard({
  trigger,
  label,
  children,
  onOpen,
  still,
}: {
  trigger: React.ReactElement<Record<string, unknown>>
  label: string
  children: React.ReactNode
  onOpen?: () => void
  /** Inside another control: the chip alone, with no card of its own. */
  still?: boolean
}) {
  const P = useParts()
  const [open, setOpen] = React.useState(false)
  const returning = React.useRef(false)
  const card = React.useRef<HTMLDivElement>(null)
  if (still) return trigger
  return (
    <P.Popover
      open={open}
      onOpenChange={(next, { reason }) => {
        const o = reason === 'trigger-press' ? !open || next : next
        if (!o && card.current?.contains(document.activeElement)) returning.current = true
        setOpen(o)
      }}
    >
      <P.PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={100}
        nativeButton={false}
        render={trigger}
        onFocus={(e) => {
          if (returning.current) returning.current = false
          else if (e.currentTarget.matches(':focus-visible')) setOpen(true)
        }}
        onClick={
          onOpen &&
          ((e) => {
            // The press is the quick view's alone: kept from the popover, its hover still works.
            e.preventBaseUIHandler()
            setOpen(false)
            onOpen()
          })
        }
      />
      <P.PopoverContent
        side="top"
        align="start"
        initialFocus={false}
        ref={card}
        aria-label={label}
        className="w-72 gap-1.5 p-3"
      >
        {children}
      </P.PopoverContent>
    </P.Popover>
  )
}

const kindWords: Record<string, string> = {
  metric: 'metric',
  dimension: 'dimension',
  value: 'value',
  domain: 'domain',
  person: 'person',
}

/** Whether the words after a noun start with what it is: "in the [Sales] domain". */
/**
 * Whether a mark of punctuation comes right after a chip ("Sales:"): the chip keeps less room on
 * its right, so the mark reads as the name's own, not as a word after a space.
 */
export const markAfter = (next: LoopRun | undefined) =>
  next?.t === 'text' && /^[:;,.!?)]/.test(next.text)

export function toldAfter(next: LoopRun | undefined, id: string): boolean {
  const kind = nounKindOf(id)
  return (
    !!kind &&
    next?.t === 'text' &&
    new RegExp(`^\\s*${kindWords[kind]}(?![\\p{L}\\p{N}])`, 'iu').test(next.text)
  )
}

/** One noun as its chip, with its card. */
export function NounChip({
  id,
  nouns,
  still,
  told,
  snug,
}: {
  id: string
  nouns: Nouns
  /** Inside another control, such as a button: drawn, with no card and no press of its own. */
  still?: boolean
  /** The words right after it say what it is ("the Sales domain"): a screen reader hears it once. */
  told?: boolean
  /** A mark of punctuation comes right after it (`markAfter`). */
  snug?: boolean
}) {
  const P = useParts()
  const noun = nouns.get(id)
  const kind = nounKindOf(id)
  const domain = useDomainOf(kind === 'domain' ? id : null)
  const name = noun?.name ?? (kind === 'domain' ? domain?.name : undefined) ?? key(id)
  // Its name as shown, then what it is, said to a screen reader: "Orders, metric".
  const said = told ? null : <span className="sr-only">, {kind ? kindWords[kind] : 'name'}</span>
  const button = (className: string, style?: React.CSSProperties, body?: React.ReactNode) => (
    <span
      role={still ? undefined : 'button'}
      tabIndex={still ? undefined : 0}
      style={style}
      className={P.cn(chip, className, snug && 'pr-0.5')}
    >
      {body}
      {said}
    </span>
  )
  switch (kind) {
    case 'metric': {
      const tone = P.chipTone('metric')
      return (
        <HoverCard
          label={name}
          still={still}
          trigger={button(
            P.cn(tone.className, 'cursor-pointer'),
            tone.style,
            <>
              <P.SigmaIcon aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{name}</span>
            </>,
          )}
          onOpen={() => P.openDock('def', name)}
        >
          <MetricCard name={name} />
        </HoverCard>
      )
    }
    case 'value':
    case 'dimension': {
      const dimension = kind === 'value' ? noun?.of : { id, name }
      // The outline in the dimension's own hue, the chip dot's: 3:1 or more in both themes.
      const style = {
        '--chip-h': dimensionHue(dimension?.id ?? id),
        borderColor: 'oklch(0.62 0.14 var(--chip-h))',
      } as React.CSSProperties
      return (
        <HoverCard
          label={name}
          still={still}
          trigger={button(
            P.cn(
              'border bg-transparent text-chip-foreground',
              kind === 'dimension' && 'border-dashed',
            ),
            style,
            <>
              <DimensionGlyph dimension={kind === 'dimension'} type={noun?.type ?? null} />
              <span className="min-w-0 truncate">{name}</span>
            </>,
          )}
        >
          <p className="text-xs text-muted-foreground">
            {kind === 'value' ? `A value of ${dimension?.name ?? 'a dimension'}` : 'A dimension'}
          </p>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            {kind === 'value'
              ? `What context items apply to when they name ${name}.`
              : `Every value of ${name}.`}
          </p>
        </HoverCard>
      )
    }
    case 'domain': {
      const hue = P.domainHue(key(id).replace(/^area_/, ''))
      return (
        <HoverCard
          label={name}
          still={still}
          trigger={button(
            'bg-muted text-foreground',
            undefined,
            <>
              {/* Its hue's dot, or a neutral ring for a domain with none (the sandbox), as DomainDot. */}
              <span
                aria-hidden
                style={hue === null ? undefined : ({ '--chip-h': hue } as React.CSSProperties)}
                className={P.cn(
                  'size-2 shrink-0 self-center rounded-full',
                  hue === null ? 'border border-muted-foreground' : 'bg-chip-dot',
                )}
              />
              <span className="min-w-0 truncate">{name}</span>
            </>,
          )}
        >
          <p className="text-xs text-muted-foreground">Domain</p>
          <p className="text-sm font-medium">{name}</p>
          {domain?.covers && <p className="text-sm text-muted-foreground">{domain.covers}</p>}
          {!!domain?.owners.length && (
            <p className="text-xs text-muted-foreground">Owners: {domain.owners.join(', ')}</p>
          )}
        </HoverCard>
      )
    }
    case 'person':
      return <PersonChip name={name} still={still} />
    default:
      return <>{name}</>
  }
}

export function PersonChip({ name, still }: { name: string; still?: boolean }) {
  const P = useParts()
  const person = P.usePeople().find((p) => p.name === name)
  return (
    <HoverCard
      label={name}
      still={still}
      trigger={
        <span
          role={still ? undefined : 'button'}
          tabIndex={still ? undefined : 0}
          className={P.cn(chip, 'pr-0 pl-0.5 font-normal')}
        >
          <span aria-hidden className="inline-flex">
            <P.PersonAvatar name={name} size={16} />
          </span>
          {/* The name alone sets the chip's baseline, so it sits on the line with the words around
              it, not the initials in the face. */}
          <span className="min-w-0 self-baseline truncate">{name}</span>
          <span className="sr-only">, person</span>
        </span>
      }
    >
      <div className="flex items-center gap-2.5">
        <P.PersonAvatar name={name} size={32} />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {person?.role && <p className="truncate text-xs text-muted-foreground">{person.role}</p>}
          {person?.email && (
            <p className="truncate text-xs text-muted-foreground">{person.email}</p>
          )}
        </div>
      </div>
    </HoverCard>
  )
}

/** A metric's card: its definition as its tool words it, its domain and owners, and the way to it. */
function MetricCard({ name }: { name: string }) {
  const P = useParts()
  const d = P.useDefinitions().find((x) => x.name === name && x.type === 'metric')
  const domain = useDomainOf(d?.domain ? `domain:${d.domain}` : null)
  return (
    <>
      <p className="text-xs text-muted-foreground">Metric{d?.tool ? ` · from ${d.tool}` : ''}</p>
      <p className="text-sm font-medium">{name}</p>
      {d?.definition && (
        <p className="line-clamp-3 text-sm text-muted-foreground">{d.definition}</p>
      )}
      {domain && (
        <p className="text-xs text-muted-foreground">
          In {domain.name}
          {domain.owners.length ? ` · owners ${domain.owners.join(', ')}` : ''}
          {d?.sourceNames.length ? ` · also called ${d.sourceNames.join(', ')}` : ''}
        </p>
      )}
      <button
        type="button"
        onClick={() => P.openDock('def', name)}
        className="w-fit rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Open the definition
      </button>
    </>
  )
}

/** A context item's kind as the reads name it ("rule", "warning") or as the app does. */
const kindOf = (kind: string): Kind =>
  kind === 'warning'
    ? 'issue'
    : kind === 'event' || kind === 'guide' || kind === 'issue'
      ? kind
      : 'note'

/** A row's status as the Context list says it, with its day: "Live · checked 12 Sep 2026". */
export function statusWords(item: Pick<LoopItem, 'status' | 'checked' | 'outOfDate'>) {
  const due = item.status === 'due' || !!item.outOfDate
  return {
    due,
    words: (item.status === 'archived' ? 'Archived' : due ? 'Due for a check' : 'Live') as Status,
    day: item.outOfDate ?? (item.checked ? `checked ${dayText(item.checked, true)}` : null),
  }
}

/**
 * Why an item needs a look before its words are trusted, or null when it is fine: archived, may be
 * out of date (a read said so), or due for a check. The words are the page's, from the one list.
 */
export function useNeedsLook() {
  const { ANSWER_LINES } = useParts()
  const stale = ANSWER_LINES.find((l) => l.state === 'stale')!.long
  return (item: Pick<LoopItem, 'status' | 'outOfDate'>) =>
    item.status === 'archived'
      ? 'Archived'
      : item.outOfDate
        ? stale
        : item.status === 'due'
          ? 'Due for a check'
          : null
}

/** A status with its dot, as the Context list draws it: live green, due for a check amber. */
function StatusMark({ status }: { status: Status }) {
  const dot = status === 'Live' ? 'bg-good' : status === 'Due for a check' ? 'bg-caution' : 'bg-off'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      {status}
    </span>
  )
}

/**
 * The source a reader points at under the answer, by its number: its marks in the words light up
 * with it, so a source chip and the sentences it backs are seen together.
 */
export const LitSource = React.createContext<{
  lit: number | null
  light: (n: number | null) => void
}>({ lit: null, light: () => {} })

/** A citation: its number where it is cited; its card names the item, and a press opens it. */
export function CiteMark({ n, item }: { n: number; item?: LoopItem }) {
  const P = useParts()
  const { lit } = React.useContext(LitSource)
  const marker =
    'relative ml-0.5 mr-px inline-flex h-6 min-w-6 -translate-y-px cursor-default items-center justify-center rounded-md bg-muted px-1.5 align-middle text-xs font-medium text-foreground tabular-nums outline-none transition-colors after:absolute after:-inset-[13px] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50'
  const shown = P.cn(marker, lit === n && 'bg-foreground text-background hover:bg-foreground')
  if (!item)
    return (
      <span className={shown} aria-label={`Source ${n}`}>
        {n}
      </span>
    )
  return (
    <HoverCard
      label={item.title}
      trigger={
        <span
          role="button"
          tabIndex={0}
          aria-label={`Source ${n}: ${item.title}`}
          // A press opens the item.
          className={P.cn(shown, 'cursor-pointer')}
        >
          {n}
        </span>
      }
      onOpen={() => P.openDock('context', item.id)}
    >
      <ItemCard item={item} />
    </HoverCard>
  )
}

/**
 * A source under the answer as a chip (the source chips): its number, the kind's icon, its title
 * cut to the chip, and the day it was last checked where the column has room. Its card names it
 * whole, a press opens it, and pointing at it lights its marks in the words.
 */
export function SourceChip({ item }: { item: LoopItem & { n: number } }) {
  const P = useParts()
  const { lit, light } = React.useContext(LitSource)
  const Icon = P.kindIcons[kindOf(item.kind)]
  const on = () => light(item.n)
  const off = () => light(null)
  return (
    <HoverCard
      label={item.title}
      trigger={
        // Its name is what it shows, so a voice command can say what it reads (WCAG 2.5.3):
        // "Source 1: Online sales to Norway stopped, checked 21 Nov 2026".
        <span
          role="button"
          tabIndex={0}
          onPointerEnter={on}
          onPointerLeave={off}
          onFocus={on}
          onBlur={off}
          className={P.cn(
            'group/chip inline-flex h-8 max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-background pr-2.5 pl-1 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted',
            lit === item.n && 'bg-muted',
          )}
        >
          <span className="sr-only">Source {item.n}: </span>
          <span
            aria-hidden
            className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-muted px-1.5 text-xs font-medium tabular-nums group-hover/chip:bg-background group-data-popup-open/chip:bg-background"
          >
            {item.n}
          </span>
          <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium">{item.title}</span>
          {item.checked && (
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground @max-md/sources:sr-only">
              <span className="sr-only">, </span>
              checked {dayText(item.checked, true)}
            </span>
          )}
        </span>
      }
      onOpen={() => P.openDock('context', item.id)}
    >
      <ItemCard item={item} />
    </HoverCard>
  )
}

/** An item's card: its kind and domain, its status, who checked it and when, what it says. */
function ItemCard({ item }: { item: LoopItem }) {
  const P = useParts()
  // Its card is showing: the quick view it opens is read ahead.
  P.useReadCitedAhead([item.id], true)
  const fact = P.useFacts().find((f) => f.id === item.id)
  const domain = useDomainOf(item.domain)
  const Icon = P.kindIcons[kindOf(item.kind)]
  const status = statusWords(item)
  return (
    <>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {domain?.name ?? 'Context item'}
      </p>
      <p className="text-sm leading-snug font-medium">{item.title}</p>
      <p className="text-xs text-muted-foreground">
        {status.words}
        {fact?.checkedBy
          ? ` · checked by ${fact.checkedBy}, ${fact.checkedOn}`
          : status.day
            ? ` · ${status.day}`
            : ''}
      </p>
      {fact?.summary && (
        <p className="line-clamp-3 text-sm text-muted-foreground">{fact.summary}</p>
      )}
      <button
        type="button"
        onClick={() => P.openDock('context', item.id)}
        className="w-fit rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Open it
      </button>
    </>
  )
}

/** The characters a run takes as the answer draws it: what the reveal counts (`Runs` `upTo`). */
export function runLength(run: LoopRun, nouns: Nouns): number {
  switch (run.t) {
    case 'text':
      return run.text.length
    case 'noun':
      return (nouns.get(run.id)?.name ?? key(run.id)).length
    case 'cite':
      return 1
    case 'count':
      return run.value.length + (run.of ? run.of.length + 1 : 0)
    case 'date':
      return dayText(run.day).length
  }
}

/** How a word, a chip or a mark comes in as the words are revealed: a fade (none with reduced motion). */
const wordIn = 'animate-in fade-in-0 duration-(--ask-word-fade)'

/**
 * Runs of words as the answer draws them. A noun gets its chip the first time the answer names it
 * (`seen`), plain words after; punctuation right after a chip stays with it on the line. With
 * `upTo`, only that many characters show (`runLength`): plain words a whole word at a time, a chip,
 * mark, count or day whole once the reveal is past it, each fading in as it comes.
 */
export function Runs({
  runs,
  nouns,
  items,
  seen,
  upTo,
}: {
  runs: readonly LoopRun[]
  nouns: Nouns
  items: ReadonlyMap<number, LoopItem>
  seen?: Set<string>
  upTo?: number
}) {
  // Where each run ends, in the characters the reveal counts.
  const ends: number[] = []
  for (const r of runs) ends.push((ends.at(-1) ?? 0) + runLength(r, nouns))
  return (
    <>
      {runs.map((r, i) => {
        const from = i ? ends[i - 1]! : 0
        // Plain words go a word at a time, the same spans from the first word to the last, so a
        // word that is in never fades in again; their mark and their link come with the first.
        if (upTo !== undefined && r.t === 'text')
          return upTo - from < (/^\s*\S+/.exec(r.text)?.[0].length ?? 0) ? null : (
            <Styled key={i} run={r}>
              <Typed text={r.text} upTo={upTo - from} />
            </Styled>
          )
        if (upTo !== undefined && ends[i]! > upTo) return null
        const drawn = run(r, i)
        return upTo === undefined ? (
          drawn
        ) : (
          <span key={i} className={wordIn}>
            {drawn}
          </span>
        )
      })}
    </>
  )

  function run(r: LoopRun, i: number) {
    switch (r.t) {
      case 'text':
        return (
          <Styled key={i} run={r}>
            {r.text}
          </Styled>
        )
      case 'noun': {
        if (seen?.has(r.id))
          return <React.Fragment key={i}>{nouns.get(r.id)?.name ?? key(r.id)}</React.Fragment>
        seen?.add(r.id)
        return (
          <NounChip
            key={i}
            id={r.id}
            nouns={nouns}
            told={toldAfter(runs[i + 1], r.id)}
            snug={markAfter(runs[i + 1])}
          />
        )
      }
      case 'cite':
        return <CiteMark key={i} n={r.n} item={items.get(r.n)} />
      case 'count':
        return (
          <React.Fragment key={i}>
            <span className="font-semibold tabular-nums">{r.value}</span>
            {r.of && ` ${r.of}`}
          </React.Fragment>
        )
      case 'date':
        return (
          <time
            key={i}
            dateTime={r.day}
            className="tabular-nums underline decoration-dotted underline-offset-4"
          >
            {dayText(r.day)}
          </time>
        )
    }
  }
}

/**
 * Plain words as the model set them in Markdown: bold, italic, struck through or as code, and on
 * their link, which opens in a new tab as the help's own links do. A link only ever goes to a web
 * or mail address or a help page that exists; any other is plain words.
 */
function Styled({
  run,
  children,
}: {
  run: Extract<LoopRun, { t: 'text' }>
  children: React.ReactNode
}) {
  const P = useParts()
  let node = (
    <Marks marks={run.marks ?? []} code={answerCode}>
      {children}
    </Marks>
  )
  const link = run.link
  const href = !link
    ? null
    : 'url' in link
      ? safeHref(link.url)
      : P.docTitle(link.slug)
        ? P.docHref(link.slug, link.id)
        : null
  if (href)
    node = (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="rounded-xs text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {node}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  return <>{node}</>
}

/**
 * Plain words cut at a reveal: the whole words within `upTo` characters, each fading in, with the
 * spaces before them, and those after the last word, so a chip or a day after them keeps its space.
 */
function Typed({ text, upTo }: { text: string; upTo: number }) {
  const words = [...text.matchAll(/\s*\S+(?:\s+$)?|^\s+$/g)].filter(
    (m) => m.index + m[0].length <= upTo,
  )
  return (
    <>
      {words.map((m) => (
        <span key={m.index} className={wordIn}>
          {m[0]}
        </span>
      ))}
    </>
  )
}

/**
 * One item as a row: its kind's icon, its title (its number first when the answer cites it), and
 * a line with what it applies to, its domain, its status and its day, so two items with the same
 * title are told apart. A press opens it.
 */
export function ItemRow({
  item,
  nouns,
  twin,
}: {
  item: LoopItem
  nouns: Nouns
  /** Another row has the same title. */
  twin?: boolean
}) {
  const P = useParts()
  const ahead = P.useReadAhead()
  const Icon = P.kindIcons[kindOf(item.kind)]
  const status = statusWords(item)
  const values = item.about.filter((id) => id.startsWith('value:'))
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-start gap-2 text-sm">
        {item.n ? (
          <CiteMark n={item.n} item={item} />
        ) : (
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <button
          type="button"
          {...ahead(item.id)}
          onClick={() => P.openDock('context', item.id)}
          className="rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {item.n && <Icon aria-hidden className="mr-1 inline size-3.5 text-muted-foreground" />}
          {item.title}
        </button>
      </span>
      <span className="ml-6 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {values.map((id) => (
          <NounChip key={id} id={id} nouns={nouns} />
        ))}
        {item.domain && <NounChip id={item.domain} nouns={nouns} />}
        {/* One run of words, a no-break space before each dot: a wrapped line never starts with one. */}
        <span className="min-w-0">
          <StatusMark status={status.words} />
          {status.day && `\u00a0· ${status.day}`}
          {twin && '\u00a0· another item with the same title'}
        </span>
      </span>
    </li>
  )
}

/**
 * A cited item in one line: its number, its kind's icon and its title, cut to the line when long
 * (the number's card and the name say it whole). Its domain, status, day and the rest are on the
 * card. A press on the title opens it. An item that needs a look ends in why, in words that stand
 * out from the line's muted ones, then what can be done about it.
 */
export function CompactItemRow({ item, action }: { item: LoopItem; action?: React.ReactNode }) {
  const P = useParts()
  const ahead = P.useReadAhead()
  const Icon = P.kindIcons[kindOf(item.kind)]
  const why = useNeedsLook()(item)
  const muted = why === 'Archived'
  return (
    <li className="flex h-7 min-w-0 items-center gap-2 text-sm">
      {item.n && <CiteMark n={item.n} item={item} />}
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <button
        type="button"
        {...ahead(item.id)}
        onClick={() => P.openDock('context', item.id)}
        className="min-w-0 truncate rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {item.title}
      </button>
      {why && (
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${muted ? 'text-muted-foreground' : 'text-caution'}`}
        >
          <span aria-hidden className={`size-2 rounded-full ${muted ? 'bg-off' : 'bg-caution'}`} />
          {why}
        </span>
      )}
      {action}
    </li>
  )
}
