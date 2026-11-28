import * as React from 'react'
import type { FamilyParts } from '@/components/footnote/family-parts'
import type { Definition, Family } from '@/lib/definitions'
import { foundSaid } from '@domain/family-found'

// A family's quick view, meaning first (FR-142, the captain's panel A): what the family means, with
// each value it varies by as a slot, and where the words come from; the values its variants hold,
// the base and the usual variant marked in them, and how one is converted from another; who owns
// it; the context about the family and about one variant alone; then Details. Its variants are
// listed on its own page only. Loaded when a family's quick view first opens: most definitions are
// no family. A suggested family on the Names card opens the same panel (suggested-family-peek.tsx).
// What they use of the app comes as their parts (family-parts.ts), so loading them splits nothing.

const Parts = React.createContext<FamilyParts | null>(null)

/** The app's parts a family's panel draws with, from the panel's own provider. */
export function useParts(): FamilyParts {
  const parts = React.useContext(Parts)
  if (!parts) throw new Error('A family panel draws inside FamilyPartsProvider.')
  return parts
}

/** Hands a family's panel the app's parts it draws with. */
export function FamilyPartsProvider({
  parts,
  children,
}: {
  parts: FamilyParts
  children: React.ReactNode
}) {
  return <Parts.Provider value={parts}>{children}</Parts.Provider>
}

const n = (x: number) => x.toLocaleString('en-GB')

/** "Jon Abara", "Jon Abara and Sofia Brandt", "A, B and C", each name in the ink colour. */
export function BoldNames({ names }: { names: readonly string[] }) {
  return names.map((name, i) => (
    <React.Fragment key={name}>
      {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
      <b>{name}</b>
    </React.Fragment>
  ))
}

/** The family's name with its stacked tile, and what it is in one line under it. */
export function FamilyHead({
  name,
  family,
  count,
  suggested,
  joining,
}: {
  name: string
  family: Pick<Family, 'by'>
  count: number
  suggested?: boolean
  joining?: boolean
}) {
  const P = useParts()
  return (
    <>
      <P.PeekTitle
        lead={<P.TypeTile d={{ type: 'metric', family: { ...family, variants: [] } }} size="lg" />}
      >
        {name}
      </P.PeekTitle>
      <p className="mt-1 pl-10 text-sm text-pretty text-muted-foreground">
        {joining
          ? `Family of ${n(count)} new ${count === 1 ? 'variant' : 'variants'}`
          : `${suggested ? 'Suggested family' : 'Family'} of ${n(count)} metrics`}
        , {P.familyBy({ by: family.by, variants: [] })}
      </p>
    </>
  )
}

/** A value of an axis, as a chip; the base or usual variant's says so inside it. */
type Value = { value: string; marks: string[] }

/** One axis and its values, the marked first; past `max`, the rest wait behind "N more". */
function ValueRow({ axis, values, max }: { axis: string; values: Value[]; max: number }) {
  const P = useParts()
  const [all, setAll] = React.useState(false)
  const shown = all ? values : values.slice(0, max)
  const firstNew = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    if (all) firstNew.current?.focus()
  }, [all])
  return (
    <div className="grid grid-cols-(--cols-lead-23) items-start gap-3">
      <dt className="pt-0.5 text-xs leading-5 font-medium text-muted-foreground">{axis}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1.5">
        {/* The spaces between chips and in them are for a screen reader: flex lays out none. */}
        {shown.map(({ value, marks }, i) => (
          <React.Fragment key={value}>
            <span
              ref={i === max ? firstNew : undefined}
              tabIndex={i === max ? -1 : undefined}
              className={P.cn(
                'inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-2 text-xs outline-none',
                marks.length ? 'border-foreground/50 font-semibold' : 'text-foreground',
              )}
            >
              <span className="truncate">{value}</span>
              {marks.length > 0 && (
                <>
                  {' '}
                  <span className="font-normal text-muted-foreground">{marks.join(', ')}</span>
                </>
              )}
            </span>{' '}
          </React.Fragment>
        ))}
        {values.length > shown.length && (
          <P.Button
            variant="link"
            className="h-6 px-1.5 text-xs"
            onClick={() => setAll(true)}
            aria-label={`Show ${n(values.length - shown.length)} more values of ${axis}`}
          >
            {n(values.length - shown.length)} more
          </P.Button>
        )}
      </dd>
    </div>
  )
}

/**
 * What tells the family's variants apart, each axis with its values: those marked come first, the
 * rest in the order the variants give them. A long axis shows a few and "N more".
 */
export function ValueRows({
  by,
  values,
  marked = [],
}: {
  by: readonly string[]
  values: readonly (readonly string[])[]
  /** Variants whose values are marked, each value with what it is ("base", "usual"). */
  marked?: { values: readonly string[]; mark: string }[]
}) {
  return (
    <dl className="flex flex-col gap-2.5">
      {by.map((axis, i) => {
        const marksOf = (value: string) =>
          marked.flatMap((m) => (m.values[i] === value ? [m.mark] : []))
        const all = (values[i] ?? []).map((value) => ({ value, marks: marksOf(value) }))
        const ordered = [
          ...all.filter((v) => v.marks.length),
          ...all.filter((v) => !v.marks.length),
        ]
        return <ValueRow key={axis} axis={axis} values={ordered} max={i === 0 ? 8 : 6} />
      })}
    </dl>
  )
}

/** "USD and app": values in a sentence. */
const listed = (values: readonly string[]) => {
  const said = values.filter(Boolean)
  return said.length < 2 ? (said[0] ?? '') : `${said.slice(0, -1).join(', ')} and ${said.at(-1)}`
}

/** "EUR · web": a variant by the values that tell it apart. */
const valuesSaid = (values: readonly string[]) => values.filter(Boolean).join(' · ')

/** The values each axis holds, each once, in the order the variants give them. */
const axisValuesOf = (family: Family) =>
  family.by.map((_, i) => [
    ...new Set(family.variants.flatMap((v) => (v.values[i] ? [v.values[i]] : []))),
  ])

/**
 * The words the variants that say something else differ by, from the first of them: "before
 * marketplace fees". Null when the difference is no clear few words.
 */
function differingQuote(
  family: Family,
  name: string,
  differingWords: FamilyParts['differingWords'],
): string | null {
  const meaning = family.meaning
  const first = family.variants.find((v) => v.name === name)
  if (!meaning?.words || !first?.description) return null
  // The family's words with the variant's own values in the slots, against the variant's words.
  const filled = meaning.words.replace(
    /\{([^{}]+)\}/g,
    (slot, axis: string) => first.values[family.by.indexOf(axis)] ?? slot,
  )
  const words = differingWords(first.description, filled)
  const changed = words?.filter((w) => w.changed).map((w) => w.text)
  return changed?.length ? changed.join(' … ') : null
}

/** Where the meaning's words come from, by its icon. */
const sourceIcon = (P: FamilyParts) => ({
  declared: P.LockIcon,
  written: P.PencilIcon,
  common: P.SparklesIcon,
  none: P.CircleDotIcon,
})

/**
 * The meaning, the largest text in the panel, with its values as slots; one quiet line on where its
 * words come from, with Change for an owner; and one attention line when variants say otherwise.
 */
function MeaningLead({
  d,
  family,
  canChange,
}: {
  d: Definition
  family: Family
  canChange: boolean
}) {
  const P = useParts()
  const [changing, setChanging] = React.useState(false)
  const [writing, setWriting] = React.useState(false)
  const change = React.useRef<HTMLButtonElement>(null)
  // Write what it means, on Ask's card of a family with no meaning, opens the panel writing it.
  const { query } = P.useRoute()
  const asked = query.get('meaning') === 'write'
  const meaning = family.meaning
  const mayChange = !!meaning && canChange && meaning.source !== 'declared'
  const [handled, setHandled] = React.useState(false)
  if (asked !== handled && (!asked || meaning)) {
    setHandled(asked)
    if (asked && mayChange) {
      setWriting(true)
      setChanging(true)
    }
  }
  React.useEffect(() => {
    if (asked && meaning) void P.changeQuery({ meaning: undefined }, { replace: true })
  }, [asked, meaning, P])
  if (!meaning) return null
  const source = P.meaningSource(family, meaning, d.tool ?? 'its tool')
  const Icon =
    meaning.source === 'common' && meaning.base ? P.CircleDotIcon : sourceIcon(P)[meaning.source]
  const close = () => {
    setChanging(false)
    setWriting(false)
  }
  // A variant converted from another says how, which the values band shows: it says nothing else.
  const converted = new Set((family.conversions ?? []).map((c) => c.to))
  const others = meaning.differing.filter((name) => !converted.has(name))
  const differing = others.length
  const quote = differing ? differingQuote(family, others[0]!, P.differingWords) : null
  const page = `/definitions/${encodeURIComponent(d.name)}`
  return (
    <>
      {meaning.words ? (
        <p className="mt-3 text-base leading-7 text-pretty">
          <P.MeaningWords meaning={meaning} by={family.by} code="text-sm" />
        </p>
      ) : (
        <P.VariantsOwnWords family={family} code="text-sm" className="mt-3 text-base leading-7" />
      )}
      {(source || mayChange) && (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <Icon aria-hidden className="mt-0.75 size-3.5 shrink-0" />
          <span className="min-w-0">
            {source}
            {mayChange && (
              <>
                {source && ' '}
                <P.Button
                  ref={change}
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => setChanging(true)}
                  aria-label={`Change what ${d.name} means`}
                >
                  Change
                </P.Button>
              </>
            )}
          </span>
        </p>
      )}
      {differing > 0 && (
        <P.PeekAttention
          icon={P.TriangleAlertIcon}
          action={
            <P.Button
              variant="outline"
              nativeButton={false}
              render={<a href={P.href(page, { variants: 'other' })} />}
            >
              Compare
            </P.Button>
          }
        >
          {differing === 1 ? '1 variant says' : `${n(differing)} variants say`} something else
          {quote ? `: “${quote}”.` : '.'}
        </P.PeekAttention>
      )}
      {changing && (
        <React.Suspense fallback={null}>
          <P.MeaningDialog
            name={d.name}
            family={family}
            parts={P.meaningParts}
            writing={writing}
            finalFocus={writing ? change : undefined}
            onClose={close}
          />
        </React.Suspense>
      )}
    </>
  )
}

/** The variant a search found the family by, named, with its own words when they differ. */
function FoundBy({ family, name }: { family: Family; name: string }) {
  const P = useParts()
  const variant = family.variants.find((v) => v.name.toLowerCase() === name.toLowerCase())
  if (!variant) return null
  const differs = family.meaning?.differing.includes(variant.name)
  return (
    <div
      role="note"
      className="mt-4 flex items-start gap-2.5 rounded-frame border bg-muted/60 py-2.5 pr-3 pl-3 text-sm"
    >
      <P.SearchIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 break-words">
        <p>
          Found by its variant <b className="font-semibold">{variant.name}</b>
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {!variant.description ? (
            'Its tool gives no words for it.'
          ) : differs || !family.meaning?.words ? (
            <P.SourceText text={variant.description} />
          ) : (
            `Same words as the family, with ${listed(variant.values)}.`
          )}
        </p>
      </div>
    </div>
  )
}

/** An owner's pick of the variant Ask reads when a question names none of the values. */
function UsualDialog({
  name,
  family,
  onClose,
}: {
  name: string
  family: Family
  onClose: () => void
}) {
  const P = useParts()
  const write = P.useWrite()
  const [member, setMember] = React.useState<string | null>(
    family.variants.find((v) => v.name === family.usual?.member)?.name ?? null,
  )
  const saving = P.useReported<void>({
    wasnt: `The usual variant of ${name} wasn't changed.`,
    done: () => {
      P.toast(member ? `Ask uses ${member} for ${name}` : `${name} has no usual variant`)
      onClose()
    },
  })
  const sending = saving.state === 'sending'
  const by = family.by.join(' or ').toLowerCase()
  return (
    <P.Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <P.DialogContent className="sm:max-w-lg">
        <form
          noValidate
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            saving.act(() =>
              write('setFamilyUsual', { name, member, revision: family.usual?.revision ?? 0 }),
            )
          }}
        >
          <P.DialogHeader>
            <P.DialogTitle>The usual {name}</P.DialogTitle>
            <P.DialogDescription>
              The variant Ask uses when a question names no {by}. Each variant keeps its own name
              for questions that name one.
            </P.DialogDescription>
          </P.DialogHeader>
          <P.Command className="rounded-md border" label="Variants">
            <P.CommandInput placeholder="Find a variant" />
            <P.CommandList className="max-h-56">
              <P.CommandEmpty>No variant has these words in its name.</P.CommandEmpty>
              <P.CommandItem
                value="No usual variant"
                data-checked={member === null || undefined}
                onSelect={() => setMember(null)}
              >
                No usual variant
                {member === null && <span className="sr-only"> (current)</span>}
              </P.CommandItem>
              {family.variants.map((v) => (
                <P.CommandItem
                  key={v.name}
                  value={v.name}
                  data-checked={v.name === member || undefined}
                  onSelect={() => setMember(v.name)}
                >
                  {v.name}
                  {v.name === member && <span className="sr-only"> (current)</span>}
                </P.CommandItem>
              ))}
            </P.CommandList>
          </P.Command>
          {saving.problem && (
            <p role="alert" className="text-sm text-destructive">
              {saving.problem}
            </p>
          )}
          <P.DialogFooter>
            <P.DialogClose render={<P.Button type="button" variant="outline" disabled={sending} />}>
              Cancel
            </P.DialogClose>
            <P.Button type="submit" disabled={sending}>
              Save
            </P.Button>
          </P.DialogFooter>
        </form>
      </P.DialogContent>
    </P.Dialog>
  )
}

/** The values band: what tells the variants apart, the conversions, and the usual variant. */
function ValuesBand({
  d,
  family,
  canChange,
}: {
  d: Definition
  family: Family
  canChange: boolean
}) {
  const P = useParts()
  const [picking, setPicking] = React.useState(false)
  // The variant every conversion starts at, never converted itself: none when they start at two.
  const to = new Set((family.conversions ?? []).map((c) => c.to))
  const from = new Set((family.conversions ?? []).map((c) => c.from).filter((v) => !to.has(v)))
  const base = from.size === 1 ? family.variants.find((v) => from.has(v.name)) : undefined
  const usual = family.variants.find((v) => v.name === family.usual?.member)
  const gone = !!family.usual?.member && !usual
  const { lines, more } = P.conversionLines(family)
  const converted = new Set(
    (family.conversions ?? []).flatMap((c) => {
      const valuesOf = (name: string) => family.variants.find((v) => v.name === name)?.values ?? []
      const [from, to] = [valuesOf(c.from), valuesOf(c.to)]
      return to.flatMap((value, i) => (value !== from[i] ? [i] : []))
    }),
  )
  const by = family.by.join(' or ').toLowerCase()
  const page = `/definitions/${encodeURIComponent(d.name)}`
  const link = 'font-medium text-primary underline-offset-4 hover:underline'
  return (
    <P.PeekBand label="Varies by">
      <P.PeekLabel>Varies by</P.PeekLabel>
      <ValueRows
        by={family.by}
        values={axisValuesOf(family)}
        marked={[
          ...(base
            ? [{ values: base.values.map((v, i) => (converted.has(i) ? v : '')), mark: 'base' }]
            : []),
          ...(usual ? [{ values: usual.values, mark: 'usual' }] : []),
        ]}
      />
      {lines.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {lines.map((line) => (
            <p
              key={`${line.to}${line.from}${line.by}`}
              className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"
            >
              <P.ArrowRightIcon aria-hidden className="mt-0.75 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">
                <b className="font-semibold text-foreground">{line.to}</b> is converted from{' '}
                <b className="font-semibold text-foreground">{line.from}</b> by the column{' '}
                <code className="font-mono">{line.by}</code>.
              </span>
            </p>
          ))}
          {more > 0 && (
            <p className="text-xs leading-5 text-muted-foreground">
              {n(more)} more conversions are on its page.
            </p>
          )}
        </div>
      )}
      {(usual || gone || canChange) && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {usual ? (
            <>
              Ask uses <b className="font-semibold text-foreground">{valuesSaid(usual.values)}</b>{' '}
              when a question names no {by}.
              {canChange && (
                <>
                  {' '}
                  <P.Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => setPicking(true)}
                    aria-label={`Change the usual variant of ${d.name}`}
                  >
                    Change
                  </P.Button>
                </>
              )}
            </>
          ) : (
            (gone || canChange) && (
              <>
                {gone &&
                  `The usual variant, ${family.usual!.member}, is no longer in this family.${canChange ? ' ' : ''}`}
                {canChange && (
                  <>
                    <P.Button
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => setPicking(true)}
                    >
                      Pick the variant Ask uses
                    </P.Button>{' '}
                    when a question names no {by}.
                  </>
                )}
              </>
            )
          )}
        </p>
      )}
      <p className="mt-1.5 text-xs leading-5">
        <a href={P.href(page)} className={link}>
          See all {n(family.variants.length)} variants
        </a>
      </p>
      {picking && <UsualDialog name={d.name} family={family} onClose={() => setPicking(false)} />}
    </P.PeekBand>
  )
}

/** Context about the family, for all its variants, and about one variant alone. */
function ContextBand({ d, family }: { d: Definition; family: Family }) {
  const P = useParts()
  const glossary = P.useGlossary()
  const facts = P.useFacts()
  const about = glossary.contextAbout(d, facts)
  const variants = new Map(family.variants.map((v) => [v.name.toLowerCase(), v.name]))
  const own = new Set(
    [d.name, ...d.sourceNames, ...glossary.synonymsOf(d.name).map((s) => s.name)].map((x) =>
      x.toLowerCase(),
    ),
  )
  // An item is about the whole family when it names the family or one of its other names; else
  // about the variants it names, alone. Its dimensions and values name neither.
  const alone = new Map<string, number>()
  let all = 0
  for (const fact of about) {
    const named = fact.where.flatMap((w) => variants.get(w.toLowerCase()) ?? [])
    const forAll = fact.where.some((w) => own.has(w.toLowerCase())) || !named.length
    if (forAll) all += 1
    else for (const name of new Set(named)) alone.set(name, (alone.get(name) ?? 0) + 1)
  }
  const page = P.href(`/definitions/${encodeURIComponent(d.name)}`)
  const link = 'font-medium text-primary underline-offset-4 hover:underline'
  const items = (count: number) => `${n(count)} ${count === 1 ? 'item' : 'items'}`
  const each = [...alone].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
  return (
    <P.PeekBand label="Context">
      <P.PeekLabel>Context</P.PeekLabel>
      <div className="flex flex-col gap-1.5 text-sm">
        <p>
          {all ? (
            <a href={page} className={link}>
              {items(all)}
            </a>
          ) : (
            <span className="text-muted-foreground">No items yet</span>
          )}{' '}
          about {d.name}
          {all > 0 && `, for all ${n(family.variants.length)} variants`}
        </p>
        {each.slice(0, 3).map(([name, count]) => (
          <p key={name} className="text-muted-foreground">
            <a href={page} className={link}>
              {items(count)}
            </a>{' '}
            about {name} alone
          </p>
        ))}
        {each.length > 3 && (
          <p className="text-muted-foreground">
            {n(each.length - 3)} more variants have items of their own.
          </p>
        )}
      </div>
    </P.PeekBand>
  )
}

/** "dbt:orders.revenue_eur_web and 249 more": the variants' ids in their tool. */
export function RefsSaid({ refs }: { refs: readonly string[] }) {
  if (!refs.length) return null
  return (
    <span>
      <span className="font-mono text-xs break-all">{refs[0]}</span>
      {refs.length > 1 && (
        <span className="text-muted-foreground"> and {n(refs.length - 1)} more</span>
      )}
    </span>
  )
}

export default function FamilyPeek({
  parts,
  d,
  family,
}: {
  parts: FamilyParts
  d: Definition
  family: Family
}) {
  return (
    <FamilyPartsProvider parts={parts}>
      <FamilyQuickView key={d.name} d={d} family={family} />
    </FamilyPartsProvider>
  )
}

function FamilyQuickView({ d, family }: { d: Definition; family: Family }) {
  const P = useParts()
  const me = P.useMe()
  const domains = P.useDomains()
  const related = P.useRelated(P.mentionId(d.type, d.name))
  const { query } = P.useRoute()
  const page = `/definitions/${encodeURIComponent(d.name)}`
  const tool = d.tool ?? 'its tool'
  const domain = d.domain ? domains[d.domain] : undefined
  const owners = domain?.owners ?? []
  // An owner of its domain or an admin changes what it means and picks its usual variant.
  const canChange = me.admin || (!!d.domain && me.owns.includes(d.domain))
  const found = foundSaid(family.found, tool)
  const refs = family.variants.flatMap((v) => (v.ref ? [v.ref] : []))
  const matched = query.get('variant')
  return (
    <P.DockFrame
      title="Definition"
      quietTitle
      actions={
        <P.PeekBar onExpand={() => P.navigate(page)}>
          <P.DockStepper list="definitions" kind="def" id={d.name} />
        </P.PeekBar>
      }
      footer={
        <P.Button
          nativeButton={false}
          render={
            <a
              href={P.href('/context/new', {
                metric: d.name,
                domain: d.domain,
                from: 'definition',
              })}
            />
          }
        >
          <P.PlusIcon data-icon="inline-start" />
          Write context
        </P.Button>
      }
    >
      <P.PeekBands>
        <P.PeekBand first>
          <FamilyHead name={d.name} family={family} count={family.variants.length} />
          <MeaningLead d={d} family={family} canChange={canChange} />
          {matched && <FoundBy family={family} name={matched} />}
        </P.PeekBand>
        <ValuesBand d={d} family={family} canChange={canChange} />
        <P.PeekBand label="Where it comes from">
          <P.PeekFacts>
            <P.PeekFact icon={P.LockIcon}>
              <b>{domain?.name ?? 'All domains'}</b> - read from {tool}, and changed there
              {d.fileUrl && (
                <>
                  {' '}
                  -{' '}
                  <a
                    href={d.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline"
                  >
                    Open in source
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </>
              )}
            </P.PeekFact>
            {owners.length > 0 && (
              <P.PeekFact icon={P.UserIcon}>
                Owned by <BoldNames names={owners} />
              </P.PeekFact>
            )}
          </P.PeekFacts>
        </P.PeekBand>
        <ContextBand d={d} family={family} />
        {related.links.length > 0 && (
          <P.PeekBand label="Related">
            <P.PeekLabel>Related</P.PeekLabel>
            <P.Related id={P.mentionId(d.type, d.name)} />
          </P.PeekBand>
        )}
        <P.PeekBand flush>
          <P.PeekDetails
            rows={[
              ['Type', 'Family of metrics'],
              ...(found ? ([['Found', found]] as [string, React.ReactNode][]) : []),
              ...(refs.length
                ? ([[`${tool} names`, <RefsSaid key="v" refs={refs} />]] as [
                    string,
                    React.ReactNode,
                  ][])
                : []),
              ...(d.changed
                ? ([['Changed', `In ${tool} on ${d.changed}`]] as [string, string][])
                : []),
            ]}
            links={[
              <P.PeekLink
                key="try"
                icon={P.FlaskConicalIcon}
                onClick={() =>
                  P.openDock('ask', undefined, { q: `How did ${d.name} change last month?` })
                }
              >
                Try it with a question
              </P.PeekLink>,
            ]}
          />
        </P.PeekBand>
      </P.PeekBands>
    </P.DockFrame>
  )
}
