import * as React from 'react'
import {
  BookAIcon,
  ChevronDownIcon,
  ListFilterIcon,
  ListTreeIcon,
  PencilIcon,
  RefreshCwIcon,
  PlusIcon,
  ExternalLinkIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
  EqualIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { ToolLogo } from '@/components/footnote/tool-logo'
import { connectorByTool, connectorById, definitionsConnectHref } from '@/model/catalogue'
import { integrationHref } from '@/model/integrations'
import { PersonAvatar } from '@/components/footnote/bits'
import { AnotherNameFor, FamilyChip, TypeTile } from '@/components/footnote/definition'
import { TypeGlyph } from '@/components/footnote/type-glyph'
import { TagChip } from '@/components/footnote/tag-chip'
import {
  AddRow,
  BarSpacer,
  barButton,
  Count,
  FilterChip,
  FilterRow,
  FilterValue,
  GroupRow,
  Highlight,
  ListBar,
  RowMenu,
  SearchField,
  SortMenu,
  SortTh,
  Th,
  thClass,
} from '@/components/footnote/list'
import { Checkbox } from '@/components/ui/checkbox'
import { useSelection } from '@/hooks/use-selection'
import { DefinitionsBulk } from '@/components/footnote/definitions-bulk'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { definitionsPageQuery } from '@/api/queries'
import type { DomainId } from '@/model/items'
import {
  definitionCounts,
  familyBy,
  typeLabel,
  toolOf,
  connectorOf,
  listIndex,
  type Definition,
  type ListIndex,
  type DefinitionType,
  useDefinitions,
  useGlossary,
} from '@/lib/definitions'
import { WindowRows, type WindowRowsHandle } from '@/components/footnote/window-rows'
import { closeDock, openDock, openFromRow, useDock } from '@/lib/dock'
import { clicked, flipped, startOf, type SortKey, type Sorting } from '@/lib/sort'
import { matches, matchesWords, usePublishOrder, useRowKeys, words, wordsIn } from '@/lib/list'
import { href, navigate, useRoute } from '@/lib/router'
import { useDomainList, useDomains, useFacts } from '@/lib/workspace'
import { APP_URL } from '@/lib/brand'
import { TruncatedText } from '@/components/footnote/truncated'
import { SourceText, sourceWords } from '@/components/footnote/source-text'
import { TextSwitch } from '@/components/footnote/switches'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { byPointer, moveRows, type Press } from '@/lib/list-motion'
import { plainText } from '@/lib/mentions'
import { LoadError, RefreshError, useLoadPhase } from '@/components/footnote/load-state'
import { TableBodySkeleton } from '@/components/footnote/list-skeleton'
import { heldRows, useRowsAfterFirstFrame } from '@/lib/loading'
import { useFigures } from '@/lib/figures'
import { useLeavingRows } from '@/lib/presence'

// Definitions: the data glossary, laid out like the Footnote app's catalogue. Views with counts (All,
// Metrics, Dimensions, Terms), a line saying where the definitions come from, the same quiet bar
// and compact rows as Context, grouped by domain by default, and v1's two cues in the Status
// column: Definition changed, and No context yet with Write one. Metrics and dimensions come from
// their tool; terms are the business's own words, written here.

type View = 'all' | DefinitionType
type Cue = 'conflict' | 'changed' | 'none'
type Group = 'domain' | 'type' | 'group' | 'none'
/** The ways to group, in words: a view's group is its tool's, named when there is one tool. */
const groupsOf = (tool: string | undefined): Record<Group, string> => ({
  domain: 'Domain',
  type: 'Type',
  group: `Group in ${tool ?? 'its tool'}`,
  none: 'No grouping',
})
const SORTS = {
  coverage: { label: 'Coverage', first: 'desc', ways: { desc: 'No context first' } },
  name: { label: 'Name', first: 'asc', ways: { asc: 'A to Z', desc: 'Z to A' } },
  context: { label: 'Context', first: 'desc', ways: { desc: 'Most first', asc: 'Fewest first' } },
  updated: {
    label: 'Last changed',
    first: 'desc',
    ways: { desc: 'Newest first', asc: 'Oldest first' },
  },
  best: { label: 'Best match', first: 'desc', ways: { desc: 'Closest first' } },
} satisfies Record<string, SortKey>
type Sort = keyof typeof SORTS
const CUES: Record<Cue, string> = {
  conflict: 'Two meanings',
  changed: 'Definition changed',
  none: 'No context yet',
}
const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
const plural = (n: number, one: string) =>
  `${n.toLocaleString('en-GB')} ${one}${n === 1 ? '' : 's'}`
const COLS = 8

/* ---------- the list ---------- */

/** A row's cue: its conflict includes the words folded into it, so folding never hides one. */
function cueFor(d: Definition, index: ListIndex, synonymRows: boolean): Cue | undefined {
  if (index.conflictOf(d) || (!synonymRows && index.alsoCalled(d).some((x) => index.conflictOf(x))))
    return 'conflict'
  if (d.changed) return 'changed'
  return d.type !== 'dimension' && !d.sameAs && index.contextAbout(d).length === 0
    ? 'none'
    : undefined
}

const NO_DEFINITIONS: Definition[] = []
/** A line of the list: a group's heading, or a definition. */
type Line = { heading: string; rows: Definition[]; open: boolean } | Definition
const NO_LINES: Line[] = []
const keyOfLine = (l: Line) => ('heading' in l ? `group:${l.heading}` : l.name)
/** The heights the lines are drawn at (h-8 and h-row), until a phone's taller rows are measured. */
const heightOfLine = (l: Line) => ('heading' in l ? 32 : 36)

/**
 * How many columns a table draws now, for the rows that span them all (a group, Add, the skeleton).
 * Its header cells come and go with its width, and a cell spanning more columns than are drawn makes
 * empty ones, which a fixed layout gives the room its named columns need: on a phone the names got
 * none. The ref it gives the table also sets `tableRef`.
 */
function useShownColumns(tableRef: React.RefObject<HTMLTableElement | null>, all: number) {
  const [shown, setShown] = React.useState(all)
  const ref = React.useCallback(
    (t: HTMLTableElement | null) => {
      tableRef.current = t
      const cells = [...(t?.tHead?.rows[0]?.cells ?? [])]
      const count = () =>
        setShown(
          cells.reduce((n, c) => n + (getComputedStyle(c).display === 'none' ? 0 : c.colSpan), 0),
        )
      count()
      // A cell that hides or shows changes size, so watching the cells sees every change.
      const watch = new ResizeObserver(count)
      for (const c of cells) watch.observe(c)
      return () => {
        watch.disconnect()
        tableRef.current = null
      }
    },
    [tableRef],
  )
  return [shown, ref] as const
}

/**
 * What a name ends with in brackets, and the rest: "Channel (orders)" is "Channel" and " (orders)".
 * Names that share their start differ there, so it is what a narrow row must not cut.
 */
const endOf = (name: string) => /^(.*\S)(\s+\([^()]*\)(?:\s*\([^()]*\))*)$/.exec(name)

/**
 * A name that is cut before its bracketed end, never in it: at 390 wide "Acquisition Channel First
 * Touch (orders)" reads "Acquisition Chan… (orders)", so two rows of one start stay apart.
 */
function NameKeepingEnd({ name, query }: { name: string; query: string }) {
  const end = endOf(name)
  if (!end)
    return (
      <TruncatedText text={name}>
        <Highlight text={name} query={query} />
      </TruncatedText>
    )
  const [, start = '', tail = ''] = end
  return (
    <span className="flex min-w-0">
      <TruncatedText text={name}>
        <Highlight text={start} query={query} />
      </TruncatedText>
      <span className="max-w-2/3 shrink-0 truncate whitespace-pre">
        <Highlight text={tail} query={query} />
      </span>
    </span>
  )
}

export function DefinitionsPage() {
  // The shell's shared read holds these rows, so a first visit draws them and reads again behind them.
  const load = useQuery({ ...definitionsPageQuery(), placeholderData: heldRows(useDefinitions()) })
  const all = load.data ?? NO_DEFINITIONS
  const showRows = useRowsAfterFirstFrame()
  // The page's frame (header, bar, table head) is drawn at once; only the rows wait, as a skeleton
  // after 150ms (docs/design/motion.md).
  const { phase, refreshFailed } = useLoadPhase(load)
  const ready = phase === 'content'
  const rowsShown = showRows && ready
  const glossary = useGlossary()
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const facts = useFacts()
  const dock = useDock()
  const { query } = useRoute()
  // Connecting definitions is a definitions tool's connect flow now, in Settings.
  const setup = !!query.get('setup')
  React.useEffect(() => {
    if (setup) navigate(definitionsConnectHref(), { setup: '1' })
  }, [setup])
  const figures = useFigures()
  const [view, setView] = React.useState<View>('all')
  const [text, setText] = React.useState('')
  // A domain page links here filtered to its domain.
  const [domain, setDomain] = React.useState<DomainId[]>(() =>
    query.get('domain') ? [query.get('domain') as DomainId] : [],
  )
  const [cues, setCues] = React.useState<Cue[]>([])
  // Synonyms fold into their definition's row as tags; this shows them as rows of their own, to audit them.
  const [synonymRows, setSynonymRows] = React.useState(false)
  const [group, setGroup] = React.useState<Group>('domain')
  const [folded, setFolded] = React.useState<string[]>([])
  const [chosenSort, setSort] = React.useState<Sorting<Sort> | null>(null)
  const reduced = useReducedMotion()
  // A pointer change of what the list shows (the view, a filter, the sort, the grouping) moves the
  // rows on screen to their new places in one view transition; the keyboard and reduced motion
  // change the list at once (lib/list-motion.ts). Typing in Search changes it at once too, as a
  // search must keep up with the hand.
  const move = (press: Press, change: () => void) => moveRows(change, reduced || !byPointer(press))

  // Led by coverage: what agents would hear Not found for comes first.
  const sorting = chosenSort ?? startOf(SORTS, text.trim() ? 'best' : 'coverage')
  const sort = sorting.key
  const way = flipped(SORTS, sorting) ? -1 : 1
  // The tool the metrics and dimensions come from, when one; neutral words when none or several.
  const tool = toolOf(all)
  const reader = connectorById(connectorOf(all))
  const source = reader ?? connectorByTool(tool)
  const GROUPS = groupsOf(tool)
  // Each row's other names and context, worked out once for the list, not once a row: a search
  // must keep up with the hand at 5,000 rows.
  const index = React.useMemo(() => listIndex(glossary.all, facts), [glossary, facts])
  const about = (d: Definition) => index.contextAbout(d).length
  const cueOf = (d: Definition) => cueFor(d, index, synonymRows)
  // The rows: every definition and term, and a synonym only in the audit view (or when what it
  // names is gone). What a search reads of each, and its cue, is worked out when the list changes,
  // not on each key: the filters, the counts and the sort read them for every row.
  const { rows, said } = React.useMemo(() => {
    const rows = all.filter((d) => synonymRows || !glossary.foldsInto(d))
    const said = new Map(
      rows.map((d) => {
        const names = `${d.name} ${d.sourceNames.join(' ')} ${(synonymRows ? [] : index.alsoCalled(d).map((x) => x.name)).join(' ')}`
        return [
          d.name,
          {
            cue: cueFor(d, index, synonymRows),
            names: names.toLowerCase(),
            words: wordsIn(
              `${names} ${plainText(d.definition)} ${d.sameAs ?? ''} ${d.group ?? ''}`,
            ),
            // A family is found by its variants' names too, and shows as itself (FR-142).
            variants: d.family?.variants.map((v) => wordsIn(v.name)) ?? [],
          },
        ]
      }),
    )
    return { rows, said }
  }, [all, glossary, index, synonymRows])
  const otherNames = (d: Definition) => (synonymRows ? [] : index.alsoCalled(d).map((x) => x.name))
  const cueOfRow = (d: Definition) => (said.has(d.name) ? said.get(d.name)!.cue : cueOf(d))
  const asked = words(text)
  // The variants of a family the words find when its own words do not: what the row then says.
  const variantHits = new Map<string, number>()
  const found = (d: Definition) => {
    const row = said.get(d.name)
    if (matchesWords(asked, row?.words ?? wordsIn(d.name))) return true
    if (!row?.variants.length) return false
    if (!variantHits.has(d.name))
      variantHits.set(d.name, row.variants.filter((v) => matchesWords(asked, v)).length)
    return variantHits.get(d.name)! > 0
  }
  const pass = (d: Definition, skip?: 'view' | 'domain' | 'cue') =>
    (skip === 'view' || view === 'all' || d.type === view) &&
    (skip === 'domain' || !domain.length || (d.domain && domain.includes(d.domain))) &&
    (skip === 'cue' || !cues.length || cues.includes(cueOfRow(d)!)) &&
    (!asked.length || found(d))
  // Found by one of its other names: the row says which, quietly.
  const matchedBy = (d: Definition) =>
    text.trim() && !matches(text, d.name)
      ? [...otherNames(d), ...d.sourceNames].find((n) =>
          asked.some((w) => n.toLowerCase().includes(w)),
        )
      : undefined
  const onSort = (k: Sort, press?: Press) => move(press, () => setSort(clicked(SORTS, sorting, k)))
  const passing = rows.filter((d) => pass(d))
  // How many of the query's words each row's names hold, once a key, for Best match. A family
  // holds what its best variant does, and a little more when that variant starts with the words:
  // "revenue eur web" finds Revenue (EUR) web first, then Net revenue (EUR) web.
  const asWords = asked.join(' ')
  const hits = new Map(
    sort === 'best'
      ? passing.map((d) => {
          const row = said.get(d.name)
          const own = asked.filter((w) => row?.names.includes(w)).length
          const variants = variantHits.get(d.name)
            ? Math.max(
                ...row!.variants.map(
                  (v) =>
                    asked.filter((w) => v.some((h) => h.startsWith(w))).length +
                    (v.filter(Boolean).join(' ').startsWith(asWords) ? 0.5 : 0),
                ),
              )
            : 0
          return [d.name, Math.max(own, variants)]
        })
      : [],
  )
  const shown = passing.sort((a, b) =>
    sort === 'coverage'
      ? Number(cueOfRow(b) === 'none') - Number(cueOfRow(a) === 'none') ||
        a.name.localeCompare(b.name)
      : sort === 'context'
        ? way * (about(b) - about(a))
        : sort === 'updated'
          ? way * (Date.parse(b.updated) - Date.parse(a.updated))
          : sort === 'best'
            ? hits.get(b.name)! - hits.get(a.name)! || a.name.localeCompare(b.name)
            : way * a.name.localeCompare(b.name),
  )
  const keyOf = (d: Definition) =>
    group === 'type'
      ? `${typeLabel[d.type]}s`
      : group === 'group'
        ? (d.group ?? 'Terms')
        : group === 'domain'
          ? d.domain
            ? (domains[d.domain]?.name ?? 'All domains')
            : 'All domains'
          : ''
  const groups =
    group === 'none'
      ? [{ key: '', rows: shown }]
      : [...new Set(shown.map(keyOf))]
          .sort((a, b) => (a === 'All domains' ? 1 : b === 'All domains' ? -1 : a.localeCompare(b)))
          .map((key) => ({ key, rows: shown.filter((d) => keyOf(d) === key) }))
  const visible = groups.flatMap((g) => (folded.includes(g.key) ? [] : g.rows))
  const order = visible.map((d) => d.name)
  // One flat list of lines, not a fragment per group: a row keeps its place in the tree when the
  // grouping changes, so it moves to its new place instead of being drawn again. Only the lines in
  // view are drawn (WindowRows).
  const lines: Line[] = groups.flatMap((g) => {
    const open = !folded.includes(g.key)
    return [...(g.key ? [{ heading: g.key, rows: g.rows, open }] : []), ...(open ? g.rows : [])]
  })
  const drawn = React.useRef<WindowRowsHandle>(null)
  usePublishOrder('definitions', order)
  const table = React.useRef<HTMLTableElement>(null)
  const sel = useSelection(order, { scope: table })
  const [cols, tableRef] = useShownColumns(table, COLS)

  const peeked = dock?.kind === 'def' ? dock.id : undefined
  // What can have context of its own: metrics and terms with their own meaning.
  const measurable = all.filter((d) => d.type !== 'dimension' && !d.sameAs)
  const uncovered = measurable.filter((d) => about(d) === 0)
  const filters = domain.length + cues.length + Number(synonymRows)
  // Each view's count, in one pass over the rows.
  const byView: Record<View, number> = { all: 0, metric: 0, dimension: 0, term: 0 }
  for (const d of rows)
    if (pass(d, 'view')) {
      byView.all++
      byView[d.type]++
    }
  const typeCount = (t: View) => byView[t]
  const rowKeys = useRowKeys({
    rows: { order, reveal: (name, then) => drawn.current?.reveal(name, then) },
    onMove: (name) => peeked && openDock('def', name),
    // Escape closes the peek first, then clears the selection.
    onEscape: () => {
      if (peeked) closeDock()
      else if (sel.count) sel.clear()
      else return false
      return true
    },
  })
  const clearAll = () => {
    setSynonymRows(false)
    setDomain([])
    setCues([])
    setText('')
    setView('all')
  }

  /** A flag only when something needs a look: a conflict, a definition its tool changed, or no description in it. */
  const foldedConflict = (d: Definition) =>
    synonymRows ? undefined : index.alsoCalled(d).find((x) => index.conflictOf(x))
  const flagOf = (d: Definition) =>
    index.conflictOf(d)
      ? { icon: TriangleAlertIcon, tip: index.conflictOf(d)!.message }
      : foldedConflict(d)
        ? {
            icon: TriangleAlertIcon,
            tip: `Another name for it has a conflict: ${index.conflictOf(foldedConflict(d)!)!.message}`,
          }
        : d.changed
          ? {
              icon: RefreshCwIcon,
              tip: `Definition changed in ${d.tool ?? 'its tool'} on ${d.changed}. Context about it comes back to its owners to check.`,
            }
          : d.synced && /^No description/.test(d.definition)
            ? {
                icon: TriangleAlertIcon,
                tip: `No description in ${d.tool ?? 'its tool'}. Agents get the name only.`,
              }
            : undefined

  // Rows that leave (deleted in bulk) fade out first.
  const leaving = useLeavingRows()
  const row = (d: Definition, measure: React.ComponentProps<'tr'>) => {
    const target = d.sameAs ? glossary.find(d.sameAs) : undefined
    const flag = flagOf(d)
    const n = about(d)
    const family = d.family
    // The row already says what tells the variants apart: its meaning says what writing about it does.
    const subject = family ? undefined : glossary.meaningOf(d)
    const meaning = family
      ? `Context about it applies to all ${family.variants.length.toLocaleString('en-GB')} variants.`
      : plainText(subject?.definition ?? '')
    // Found by its variants' words alone, a family says how many: never which (FR-142).
    const matched = family && text.trim() ? (variantHits.get(d.name) ?? 0) : 0
    const rowFacts = [
      group !== 'domain' && (d.domain ? domains[d.domain]?.name : 'All domains'),
      d.type === 'dimension' ? 'Every context item' : n ? `${n} context` : 'No context yet',
    ].filter(Boolean)
    const name = (
      <button
        type="button"
        data-row-open={d.name}
        aria-label={
          family
            ? `${d.name}, family of ${family.variants.length.toLocaleString('en-GB')} ${family.variants.length === 1 ? 'variant' : 'variants'}`
            : undefined
        }
        className="flex min-h-6 min-w-0 shrink items-center text-left font-medium outline-none hover:underline"
        onClick={(e) => {
          e.stopPropagation()
          if (!sel.titleClick(d.name, e)) openFromRow('def', d.name)
        }}
      >
        <NameKeepingEnd name={d.name} query={text} />
      </button>
    )
    // The lock is said once, in the line above the table; a row shows only who wrote a term.
    const source = d.synced ? null : (
      <span title={`Written by ${d.by}, ${d.updated}`} className="inline-flex">
        <PersonAvatar name={d.by ?? 'Someone'} size={20} />
      </span>
    )
    const isSel = sel.isSelected(d.name)
    return (
      <tr
        {...measure}
        aria-selected={isSel}
        data-state={isSel ? 'selected' : undefined}
        data-peeked={peeked === d.name || undefined}
        data-leaving={leaving.has(d.name) || undefined}
        data-vt-move
        className={cn(
          'group/row h-row cursor-pointer border-b text-sm row-fade hover:bg-muted/50 has-[[data-row-open]:focus-visible]:ring-3 has-[[data-row-open]:focus-visible]:ring-ring/50 has-[[data-row-open]:focus-visible]:ring-inset data-peeked:bg-muted data-peeked:shadow-peeked data-[state=selected]:bg-muted @max-xl/main:h-auto',
          family && 'h-auto',
        )}
        onMouseDown={sel.onMouseDown}
        onClick={(e) => sel.rowClick(d.name, e) || openFromRow('def', d.name)}
      >
        <td
          className="hidden w-9.5 pr-0 pl-4 align-middle md:w-11.5 md:pl-6 @xl/main:table-cell"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            aria-label={`Select ${d.name}`}
            {...sel.checkbox(d.name)}
            className={cn(
              'transition-opacity group-hover/row:opacity-100',
              !sel.count && !isSel && 'opacity-0 focus-visible:opacity-100',
            )}
          />
        </td>
        {/* The name with its type tile, its other names as tags (or, in the audit view, a synonym's Another name for); the rest are short facts. */}
        <td
          className={cn(
            'max-w-0 pr-2 pl-4 align-middle md:pl-6 @max-xl/main:py-2 @xl/main:pl-1.5',
            family && 'py-1.5',
          )}
        >
          {family ? (
            // A family's mark: the stack, "Family · 250 variants" and what tells them apart, the
            // same at every width (FR-142).
            <span className="flex min-w-0 items-center gap-2.5">
              <TypeTile d={d} />
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-2">
                  {name}
                  <FamilyChip family={family} />
                  <AlsoCalledChips names={otherNames(d)} conflicts={[]} matched={matchedBy(d)} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {familyBy(family)}
                  {rowFacts.map((fact) => (
                    <span key={String(fact)} className="@xl/main:hidden">
                      {' '}
                      · {fact}
                    </span>
                  ))}
                  {matched > 0 &&
                    ` · ${matched === 1 ? '1 variant matches' : `${matched.toLocaleString('en-GB')} variants match`}`}
                </span>
              </span>
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-2.5">
              <TypeTile d={d} />
              <span className="flex min-w-0 flex-col @xl/main:flex-row @xl/main:items-center @xl/main:gap-2">
                {name}
                {target && (
                  <AnotherNameFor target={target} className="min-w-0 @max-xl/main:hidden" />
                )}
                <AlsoCalledChips
                  names={otherNames(d)}
                  conflicts={index
                    .alsoCalled(d)
                    .filter((x) => index.conflictOf(x))
                    .map((x) => x.name)}
                  matched={matchedBy(d)}
                />
                {/* On a phone the short facts go on a second line. */}
                <span className="flex gap-2 text-xs text-muted-foreground @xl/main:hidden">
                  {rowFacts.map((fact) => (
                    <span key={String(fact)}>{fact}</span>
                  ))}
                </span>
              </span>
            </span>
          )}
        </td>
        {/* What it means, in the row: a synonym reads its target's meaning. */}
        <td className="hidden max-w-0 px-2 align-middle text-muted-foreground @min-[48rem]/main:table-cell">
          <TruncatedText
            text={(subject?.synced ? sourceWords(meaning) : meaning) || 'No meaning written yet'}
          >
            {meaning ? subject?.synced ? <SourceText text={meaning} /> : meaning : '–'}
          </TruncatedText>
        </td>
        <td
          className={cn(
            'hidden w-32 px-2 align-middle whitespace-nowrap text-muted-foreground',
            group !== 'domain' && '@min-[60rem]/main:table-cell',
          )}
        >
          {d.domain ? domains[d.domain]?.name : '–'}
        </td>
        <td className="hidden w-20 px-2 text-right align-middle tabular-nums @xl/main:table-cell">
          {d.type === 'dimension' || d.sameAs ? (
            <span
              title={
                d.type === 'dimension'
                  ? 'Dimensions apply to every context item'
                  : `Counted on ${d.sameAs}`
              }
              className="text-muted-foreground"
            >
              –
            </span>
          ) : n === 0 ? (
            // No context yet: the count becomes what to do about it.
            <Button
              variant="ghost"
              className="-mr-3 text-primary hover:text-primary"
              aria-label={`Write context about ${d.name}`}
              onClick={(e) => {
                e.stopPropagation()
                const target = glossary.meaningOf(d)
                navigate('/context/new', { metric: target.name, domain: target.domain })
              }}
            >
              Write
            </Button>
          ) : (
            <span title={`${n} context ${n === 1 ? 'item' : 'items'} about it`}>{n}</span>
          )}
        </td>
        <td className="w-8 px-1 align-middle">
          {flag && (
            <span title={flag.tip} className="inline-flex text-caution">
              <flag.icon aria-hidden className="size-4" />
              <span className="sr-only">{flag.tip}</span>
            </span>
          )}
        </td>
        <td className="w-8 px-1 align-middle">{source}</td>
        <td className="w-11 pr-2 align-middle md:pr-4" onClick={(e) => e.stopPropagation()}>
          <RowMenu
            title={d.name}
            page={href(`/definitions/${encodeURIComponent(d.name)}`)}
            link={`${APP_URL}/definitions/${encodeURIComponent(d.name)}`}
            extra={
              d.synced
                ? d.fileUrl
                  ? [
                      {
                        label: 'Open in source',
                        icon: <ExternalLinkIcon />,
                        onSelect: () => window.open(d.fileUrl, '_blank', 'noreferrer'),
                      },
                    ]
                  : []
                : [
                    {
                      label: 'Edit',
                      icon: <PencilIcon />,
                      onSelect: () => navigate(`/definitions/${encodeURIComponent(d.name)}/edit`),
                    },
                  ]
            }
          />
        </td>
      </tr>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title="Definitions" icon={<BookAIcon />}>
        {/* With a definition's quick view open, its own action (Write context) is the one solid blue button. */}
        <Button
          variant={dock?.kind === 'def' ? 'outline' : 'default'}
          onClick={() => navigate('/definitions/new')}
        >
          <PlusIcon data-icon="inline-start" />
          New term
        </Button>
      </SiteHeader>
      {/* One scroller; what it holds (the bar, the table, the totals) sits in the 80rem frame, centred. */}
      <div className="@container/main flex min-h-0 flex-1 flex-col overflow-y-auto *:mx-auto *:w-full *:max-w-wide @min-[80rem]/main:*:border-x">
        {phase === 'failed' ? (
          <LoadError
            what="the definitions"
            className="border-b"
            onRetry={() => void load.refetch()}
          />
        ) : (
          <>
            {refreshFailed && (
              <RefreshError what="the definitions" onRetry={() => void load.refetch()} />
            )}
            <ListBar>
              {/* On a phone the views fold into one menu, so the bar keeps to two rows. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      className={cn(barButton, 'text-foreground @md/main:hidden')}
                    />
                  }
                >
                  {view === 'all' ? 'All' : `${typeLabel[view]}s`}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {typeCount(view).toLocaleString('en-GB')}
                  </span>
                  <ChevronDownIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuRadioGroup
                    value={view}
                    onValueChange={(v, e) => move(e.event, () => setView(v as View))}
                  >
                    {(['all', 'metric', 'dimension', 'term'] as View[]).map((v) => (
                      <DropdownMenuRadioItem key={v} value={v}>
                        <FilterValue count={typeCount(v)}>
                          {v === 'all' ? 'All' : `${typeLabel[v]}s`}
                        </FilterValue>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Views are a filter, not navigation: quiet words with counts, the shared text switch. */}
              <TextSwitch
                label="Definitions to show"
                className="pl-1 text-sm @max-md/main:hidden"
                value={view}
                onChange={(v, press) => move(press, () => setView(v))}
                options={(['all', 'metric', 'dimension', 'term'] as View[]).map((v) => ({
                  value: v,
                  label: v === 'all' ? 'All' : `${typeLabel[v]}s`,
                  count: typeCount(v),
                  icon:
                    v !== 'all' ? (
                      <TypeGlyph d={{ type: v }} className="text-current" />
                    ) : undefined,
                }))}
              />
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border @max-3xl/main:hidden" />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      className={cn(barButton, filters > 0 && 'bg-muted text-foreground')}
                    />
                  }
                >
                  <ListFilterIcon />
                  <span className="@max-md/main:sr-only">Filter</span>
                  {filters > 0 && <span className="tabular-nums">{filters}</span>}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Status</DropdownMenuLabel>
                    {(Object.keys(CUES) as Cue[]).map((c) => (
                      <DropdownMenuCheckboxItem
                        key={c}
                        checked={cues.includes(c)}
                        onCheckedChange={(_, e) =>
                          move(e.event, () => setCues((x) => toggle(x, c)))
                        }
                      >
                        <FilterValue
                          count={all.filter((d) => cueOfRow(d) === c && pass(d, 'cue')).length}
                        >
                          {CUES[c]}
                        </FilterValue>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Another name</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      checked={synonymRows}
                      onCheckedChange={(on, e) => move(e.event, () => setSynonymRows(on))}
                    >
                      <FilterValue count={all.filter((d) => glossary.foldsInto(d)).length}>
                        <span className="inline-flex items-center gap-2">
                          <TypeGlyph d={{ type: 'term', sameAs: 'x' }} />
                          Show synonyms as rows
                        </span>
                      </FilterValue>
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Domain</DropdownMenuLabel>
                    {domainIds.map((d) => (
                      <DropdownMenuCheckboxItem
                        key={d}
                        checked={domain.includes(d)}
                        onCheckedChange={(_, e) =>
                          move(e.event, () => setDomain((x) => toggle(x, d)))
                        }
                      >
                        <FilterValue
                          count={all.filter((x) => x.domain === d && pass(x, 'domain')).length}
                        >
                          {domains[d]?.name}
                        </FilterValue>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <SortMenu
                keys={SORTS}
                sorting={sorting}
                onSort={(next, press) => move(press, () => setSort(next))}
                shown={(Object.keys(SORTS) as Sort[]).filter((k) => k !== 'best' || text.trim())}
                narrow="@max-5xl/main:sr-only"
                className="w-56"
              />
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" className={barButton} />}>
                  <ListTreeIcon />
                  <span className={cn(group === 'none' ? 'sr-only' : '@max-5xl/main:sr-only')}>
                    {group === 'none' ? 'Group' : GROUPS[group]}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Group by</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={group}
                      onValueChange={(v, e) =>
                        move(e.event, () => {
                          setGroup(v as Group)
                          setFolded([])
                        })
                      }
                    >
                      {(Object.keys(GROUPS) as Group[]).map((g) => (
                        <DropdownMenuRadioItem key={g} value={g}>
                          {GROUPS[g]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <BarSpacer>
                <SearchField value={text} onChange={setText} placeholder="Search definitions" />
              </BarSpacer>
              <Count>
                {!ready ? (
                  phase === 'skeleton' && (
                    <span role="status" aria-busy="true" aria-label="Loading" className="sr-only" />
                  )
                ) : shown.length === rows.length ? (
                  plural(rows.length, 'definition')
                ) : (
                  <>
                    <span className="font-semibold text-foreground">
                      {shown.length.toLocaleString('en-GB')}
                    </span>{' '}
                    of {plural(rows.length, 'definition')}
                  </>
                )}
              </Count>
            </ListBar>
            <FilterRow
              count={filters}
              onClear={() => (setDomain([]), setCues([]), setSynonymRows(false))}
            >
              {cues.length > 0 && (
                <FilterChip
                  field="Status"
                  values={cues.map((c) => CUES[c])}
                  onRemove={() => setCues([])}
                />
              )}
              {synonymRows && (
                <FilterChip
                  field="Another name"
                  values={['shown as rows']}
                  onRemove={() => setSynonymRows(false)}
                />
              )}
              {domain.length > 0 && (
                <FilterChip
                  field="Domain"
                  values={domain.map((d) => domains[d]!.name)}
                  onRemove={() => setDomain([])}
                />
              )}
            </FilterRow>
            {/* Where the definitions come from, as the catalogue says it under its toolbar. */}
            <p className="flex shrink-0 items-start gap-2 border-b px-4 py-2 text-xs leading-5 text-muted-foreground md:px-6">
              <ToolLogo c={source} size="sm" className="mt-0.5" />
              <span className="max-w-reading">
                Metrics and dimensions come from {tool ?? 'your definitions tool'}. To change one,
                change it in the tool. Terms are words your company uses. The owner of their domain
                writes them here.{' '}
                <a
                  href={integrationHref(reader?.id)}
                  className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {tool ?? 'Integrations'}
                  {tool && ' in Integrations'}
                </a>
                .
                {reader?.figures &&
                  ` A figure that looks wrong goes to ${figures.contact(reader.id)}, the data contact.`}
              </span>
            </p>
            {/* Coverage first: how much of what agents can be asked has nothing written down. */}
            {uncovered.length > 0 && (
              <p className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm md:px-6">
                <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {uncovered.length.toLocaleString('en-GB')} of{' '}
                    {measurable.length.toLocaleString('en-GB')} have no context yet.
                  </span>{' '}
                  <span className="text-muted-foreground">
                    Agents asking about them get Not found.
                  </span>
                </span>
                {!cues.includes('none') && (
                  <Button
                    variant="outline"

                    onClick={() => setCues(['none'])}
                  >
                    Show only these
                  </Button>
                )}
              </p>
            )}
            <div className="min-w-0 shrink-0">
              <table ref={tableRef} className="w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-raised">
                  <tr>
                    <th
                      className={cn(
                        thClass,
                        'hidden w-9.5 min-w-9.5 pr-0 pl-4 md:w-11.5 md:min-w-11.5 md:pl-6 @xl/main:table-cell',
                      )}
                    >
                      <Checkbox
                        aria-label="Select all definitions shown"
                        checked={sel.allShown}
                        indeterminate={sel.count > 0 && !sel.allShown}
                        onCheckedChange={sel.toggleAll}
                      />
                    </th>
                    <SortTh
                      keys={SORTS}
                      sorting={sorting}
                      by="name"
                      onSort={onSort}
                      className="pr-2 pl-4 md:pl-6 @xl/main:pl-1.5 @min-[48rem]/main:w-1/3"
                    />
                    <Th className="hidden px-2 @min-[48rem]/main:table-cell">Meaning</Th>
                    <Th
                      className={cn(
                        'hidden w-32 px-2',
                        group !== 'domain' && '@min-[60rem]/main:table-cell',
                      )}
                    >
                      Domain
                    </Th>
                    <SortTh
                      keys={SORTS}
                      sorting={sorting}
                      by="context"
                      onSort={onSort}
                      className="hidden w-20 min-w-20 px-2 text-right @xl/main:table-cell"
                    />
                    <Th className="w-8 min-w-6 px-1">
                      <span className="sr-only">Needs a look</span>
                    </Th>
                    <Th className="w-8 min-w-7 px-1">
                      <span className="sr-only">Source</span>
                    </Th>
                    <Th className="w-11 min-w-9 pr-2 md:min-w-11 md:pr-4">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <WindowRows
                  handle={drawn}
                  entries={rowsShown ? lines : NO_LINES}
                  keyOf={keyOfLine}
                  estimate={heightOfLine}
                  colSpan={cols}
                  keep={[peeked]}
                  onKeyDown={(e) => {
                    sel.onKeyDown(e)
                    rowKeys(e)
                  }}
                  before={
                    <>
                      {/* Hundreds of rows draw in a render of their own: their skeleton holds the place. */}
                      {(phase === 'skeleton' || (ready && !showRows)) && (
                        <TableBodySkeleton colSpan={cols} />
                      )}
                      {rowsShown && shown.length === 0 && (
                        <tr>
                          <td colSpan={cols} className="px-6 py-10 text-center text-sm">
                            <p className="font-medium">No definitions match</p>
                            <p className="mt-1 text-muted-foreground">
                              {[
                                text.trim() && `Searching for “${text.trim()}”`,
                                view !== 'all' && `${typeLabel[view]}s only`,
                                cues.length && `Status is ${cues.map((c) => CUES[c]).join(' or ')}`,
                                domain.length &&
                                  `Domain is ${domain.map((d) => domains[d]?.name).join(' or ')}`,
                              ]
                                .filter(Boolean)
                                .join(', ')}
                              .
                            </p>
                            <Button variant="outline" className="mt-3" onClick={clearAll}>
                              Clear search and filters
                            </Button>
                          </td>
                        </tr>
                      )}
                    </>
                  }
                  render={(l, measure) =>
                    'heading' in l ? (
                      <GroupRow
                        {...measure}
                        label={l.heading}
                        detail={definitionCounts(l.rows)}
                        open={l.open}
                        colSpan={cols}
                        onToggle={() => setFolded((x) => toggle(x, l.heading))}
                      />
                    ) : (
                      row(l, measure)
                    )
                  }
                  after={
                    rowsShown && (
                      <AddRow
                        label="New term"
                        colSpan={cols}
                        onClick={() => navigate('/definitions/new')}
                      />
                    )
                  }
                />
                {/* While rows are picked the bar's band holds the foot, so the totals stop sticking over the last rows. */}
                <tfoot
                  className={cn(
                    'z-raised bg-background',
                    !sel.count && 'sticky bottom-0',
                    !rowsShown && 'hidden',
                  )}
                >
                  <tr className="text-xs whitespace-nowrap text-muted-foreground tabular-nums shadow-hairline-top">
                    <td className="hidden @xl/main:table-cell" />
                    <td className="h-bar pr-2 pl-4 md:pl-6 @xl/main:pl-1.5">
                      {definitionCounts(shown) || plural(0, 'definition')}
                      {/* Each context item once, however many of these it is about. */}
                      <span className="hidden @xl/main:inline">
                        , with{' '}
                        {new Set(
                          shown.flatMap((d) =>
                            d.sameAs ? [] : index.contextAbout(d).map((f) => f.id),
                          ),
                        ).size.toLocaleString('en-GB')}{' '}
                        context items about them
                      </span>
                    </td>
                    <td className="hidden px-2 @min-[48rem]/main:table-cell" />
                    <td
                      className={cn(
                        'hidden px-2',
                        group !== 'domain' && '@min-[60rem]/main:table-cell',
                      )}
                    />
                    <td className="hidden px-2 @xl/main:table-cell" />
                    <td colSpan={3} className="pr-4 pl-1 text-right md:pr-6">
                      {shown.filter((d) => flagOf(d)).length.toLocaleString('en-GB')} to look at
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
      {/* Picked rows get their bar in a band of its own under the list, never over a row. */}
      <DefinitionsBulk sel={sel} defs={all} />
    </div>
  )
}

/* ---------- the peek ---------- */

/** A definition in the dock, read-only: what it is, its names, and the context about it. Only a term has Edit. */

/**
 * A definition's other names on its row: the first three as small tags, then "+N"; a word with a
 * conflict in the warning tone. Found by one of them in a search, the row says so quietly.
 */
function AlsoCalledChips({
  names,
  conflicts,
  matched,
}: {
  names: string[]
  conflicts: string[]
  matched?: string
}) {
  if (!names.length && !matched) return null
  const first = names.slice(0, 3)
  return (
    <span className="flex min-w-0 items-center gap-1 @max-xl/main:hidden">
      {names.length > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">Another name</span>
      )}
      {first.map((n) => (
        <TagChip
          key={n}
          tone={conflicts.includes(n) ? 'warn' : 'term'}
          icon={
            conflicts.includes(n) ? <TriangleAlertIcon aria-hidden /> : <EqualIcon aria-hidden />
          }
          className="max-w-32"
          title={conflicts.includes(n) ? `“${n}” has a conflict` : n}
        >
          {n}
        </TagChip>
      ))}
      {names.length > first.length && (
        <span
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          title={names.slice(3).join(', ')}
        >
          +{names.length - first.length}
        </span>
      )}
      {matched && (
        <span className="shrink-0 text-xs text-muted-foreground">matches: {matched}</span>
      )}
    </span>
  )
}
