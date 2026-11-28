import { foundKindWords } from '@domain/family-found'
import { andList } from '@domain/family-split'
import { useWrite } from '@/api/queries'
import { TypeTile } from '@/components/footnote/definition'
import { TableBodySkeleton } from '@/components/footnote/list-skeleton'
import { Th } from '@/components/footnote/list'
import { SourceText } from '@/components/footnote/source-text'
import { TriangleAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { familyBy, type Definition, type KeptApart } from '@/lib/definitions'
import { openFromRow } from '@/lib/dock'
import { useReported } from '@/lib/reported'
import { toast } from '@/lib/toast'
import { useDomains, useMe } from '@/lib/workspace'

// Definitions' Families tab (FR-142, D1): every family with how it was found, what it means or
// that it means nothing yet, and what needs a look, each opening its quick view; then what was kept
// apart, families split back into their metrics and the metrics of suggested families kept
// separate when published, which an owner of the domain or an admin makes one family. Everyone reads it;
// only the way back is an owner's.

const n = (x: number) => x.toLocaleString('en-GB')

/** How a family was found, as the tab says it: "From a rate", "Declared in dbt". */
function foundWords(d: Definition): string {
  const found = d.family?.found
  if (!found) return '–'
  const words =
    found === 'names' ? 'look alike, published as one' : foundKindWords(found, d.tool ?? 'its tool')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function DefinitionFamilies({
  rows,
  loading,
  onClear,
  kept,
  meaningOf,
  dueOf,
}: {
  /** The families the search and filters show, in the list's order. */
  rows: readonly Definition[]
  /** The rows are not read or drawn yet: the table holds its place instead of saying none match. */
  loading: boolean
  /** Ends the search and the filters, as the main table's empty state offers. */
  onClear: () => void
  /** What was kept apart: families split into their metrics, and metrics kept separate. */
  kept: readonly KeptApart[]
  /** A family's meaning as its row says it, or null for none yet. */
  meaningOf: (d: Definition) => string | null
  /** How many context items about the family, or any of its variants, need a recheck. */
  dueOf: (d: Definition) => number
}) {
  return (
    <>
      <div className="min-w-0 shrink-0">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <Th className="pr-2 pl-4 md:pl-6">Name</Th>
              <Th className="hidden w-48 px-2 @xl/main:table-cell">How found</Th>
              <Th className="hidden w-52 px-2 @xl/main:table-cell">Variants</Th>
              <Th className="hidden px-2 @3xl/main:table-cell">Meaning</Th>
              <Th className="hidden w-44 pr-4 pl-2 md:pr-6 @5xl/main:table-cell">Needs a look</Th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableBodySkeleton colSpan={5} />}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm">
                  <p className="font-medium">No families match</p>
                  <p className="mt-1 text-muted-foreground">
                    A family is one entry for metrics that differ only by a value, such as one per
                    currency.
                  </p>
                  <Button variant="outline" className="mt-3" onClick={onClear}>
                    Clear search and filters
                  </Button>
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <FamilyRow key={d.name} d={d} meaning={meaningOf(d)} due={dueOf(d)} />
            ))}
          </tbody>
        </table>
      </div>
      {kept.length > 0 && <KeptApartList kept={kept} />}
    </>
  )
}

function FamilyRow({ d, meaning, due }: { d: Definition; meaning: string | null; due: number }) {
  const family = d.family!
  const count = family.variants.length
  const variants = `${n(count)} ${familyBy(family)}`
  const dueWords = `${n(due)} ${due === 1 ? 'item' : 'items'} needing a recheck`
  const open = () => openFromRow('def', d.name)
  return (
    <tr
      className="group/row cursor-pointer border-b text-sm hover:bg-muted/50 has-[[data-row-open]:focus-visible]:ring-3 has-[[data-row-open]:focus-visible]:ring-ring/50 has-[[data-row-open]:focus-visible]:ring-inset"
      onClick={open}
    >
      <td className="max-w-0 py-2 pr-2 pl-4 align-middle md:pl-6">
        <span className="flex min-w-0 items-center gap-2.5">
          <TypeTile d={d} />
          <span className="flex min-w-0 flex-col">
            <button
              type="button"
              data-row-open={d.name}
              onClick={(e) => {
                e.stopPropagation()
                open()
              }}
              className="max-w-full text-left font-medium break-words outline-none hover:underline"
            >
              {d.name}
            </button>
            {/* On a narrow page the columns fold into this line under the name. */}
            <span className="text-xs text-muted-foreground @xl/main:hidden">
              {foundWords(d)}, {variants}
            </span>
            {/* What needs a look, while its column is folded: no meaning while Meaning is too. */}
            {!meaning && (
              <span className="text-xs text-caution @3xl/main:hidden">No meaning yet</span>
            )}
            {due > 0 && <span className="text-xs text-caution @5xl/main:hidden">{dueWords}</span>}
          </span>
        </span>
      </td>
      <td className="hidden px-2 align-middle text-muted-foreground @xl/main:table-cell">
        {foundWords(d)}
      </td>
      <td className="hidden px-2 align-middle text-muted-foreground @xl/main:table-cell">
        {variants}
      </td>
      <td className="hidden max-w-0 px-2 py-2 align-middle @3xl/main:table-cell">
        {meaning ? (
          <span className="line-clamp-2">
            <SourceText text={meaning} />
          </span>
        ) : (
          <span className="text-caution">No meaning yet: no words speak for all its variants</span>
        )}
      </td>
      <td className="hidden pr-4 pl-2 align-middle md:pr-6 @5xl/main:table-cell">
        {due > 0 ? (
          <span className="flex items-start gap-1.5 text-caution">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {dueWords}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
    </tr>
  )
}

/**
 * What was kept apart, while it stands so, newest first, with the way back: families split into
 * their metrics, and the metrics of suggested families kept separate when they were published.
 */
function KeptApartList({ kept }: { kept: readonly KeptApart[] }) {
  return (
    <section aria-label="Kept apart" className="flex flex-col px-4 pt-5 pb-8 md:px-6">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        Kept apart
        <span className="font-normal text-muted-foreground tabular-nums">{n(kept.length)}</span>
      </h2>
      <p className="mt-1 max-w-reading text-sm text-muted-foreground">
        Each metric here stands on its own, and the next read keeps them apart.
      </p>
      <ul className="mt-2 flex flex-col">
        {kept.map((entry) => (
          <KeptApartRow key={`${entry.how}:${entry.name}`} kept={entry} />
        ))}
      </ul>
    </section>
  )
}

/** What a row of Kept apart says happened: "split by you on 20 Nov", or kept separate. */
function keptLine(kept: KeptApart, by: string): string {
  if (kept.how === 'apart')
    return `${andList(kept.metrics)}, kept separate by ${by} on ${kept.on}, when published.`
  return `${andList(kept.metrics)}, split by ${by} on ${kept.on}. ${
    kept.items
      ? `${n(kept.items)} context ${kept.items === 1 ? 'item is' : 'items are'} still about the family and ${kept.items === 1 ? 'needs' : 'need'} a recheck.`
      : 'No context is about the family now.'
  }`
}

function KeptApartRow({ kept }: { kept: KeptApart }) {
  const me = useMe()
  const domains = useDomains()
  const write = useWrite()
  const mayJoin = me.admin || (!!kept.domain && me.owns.includes(kept.domain))
  const again = kept.how === 'split' ? ' again' : ''
  const joining = useReported<void>({
    wasnt: `${kept.name} wasn't made one family${again}.`,
    done: () => toast(`${kept.name} is one family${again}`),
  })
  const by = kept.by === me.name ? 'you' : kept.by
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3">
      {/* The words keep a reading width; the way back sits at the row's end, under the table's. */}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{kept.name}</p>
        <p className="max-w-reading text-muted-foreground">{keptLine(kept, by)}</p>
        {joining.problem && (
          <p role="alert" className="mt-1 text-destructive">
            {joining.problem}
          </p>
        )}
      </div>
      {mayJoin ? (
        <Button
          variant="outline"
          className="shrink-0 self-start"
          aria-disabled={joining.state === 'sending' || undefined}
          onClick={() => joining.act(() => write('joinFamily', { name: kept.name }))}
        >
          Make them one family{again}
        </Button>
      ) : (
        <p className="shrink-0 text-xs text-muted-foreground">
          {kept.domain && domains[kept.domain]
            ? `Owners of ${domains[kept.domain]!.name} decide`
            : 'An admin decides'}
        </p>
      )}
    </li>
  )
}
