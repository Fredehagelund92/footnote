import { foundKindWords } from '@domain/family-found'
import { andList } from '@domain/family-split'
import { useWrite } from '@/api/queries'
import { TypeTile } from '@/components/footnote/definition'
import { TableBodySkeleton } from '@/components/footnote/list-skeleton'
import { Th } from '@/components/footnote/list'
import { SourceText } from '@/components/footnote/source-text'
import { TriangleAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { familyBy, type Definition, type SplitFamily } from '@/lib/definitions'
import { openFromRow } from '@/lib/dock'
import { useReported } from '@/lib/reported'
import { toast } from '@/lib/toast'
import { useDomains, useMe } from '@/lib/workspace'

// Definitions' Families tab (FR-142, D1): every family with how it was found, what it means or
// that it means nothing yet, and what needs a look, each opening its quick view; then the families
// split back into their metrics, which an owner of the domain or an admin makes one family again.
// Everyone reads it; only the way back is an owner's.

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
  splits,
  meaningOf,
  dueOf,
}: {
  /** The families the search and filters show, in the list's order. */
  rows: readonly Definition[]
  /** The rows are not read or drawn yet: the table holds its place instead of saying none match. */
  loading: boolean
  /** Ends the search and the filters, as the main table's empty state offers. */
  onClear: () => void
  splits: readonly SplitFamily[]
  /** A family's meaning as its row says it, or null for none yet. */
  meaningOf: (d: Definition) => string | null
  /** How many context items about the family, or any of its variants, are due for a check. */
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
      {splits.length > 0 && <Splits splits={splits} />}
    </>
  )
}

function FamilyRow({ d, meaning, due }: { d: Definition; meaning: string | null; due: number }) {
  const family = d.family!
  const count = family.variants.length
  const variants = `${n(count)} ${familyBy(family)}`
  const dueWords = `${n(due)} ${due === 1 ? 'item' : 'items'} due for a check`
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

/** The families split back into their metrics, while they stand, with the way back. */
function Splits({ splits }: { splits: readonly SplitFamily[] }) {
  return (
    <section aria-labelledby="split-families" className="flex flex-col px-4 pt-5 pb-8 md:px-6">
      <h2 id="split-families" className="flex items-baseline gap-2 text-sm font-semibold">
        Split into metrics
        <span className="font-normal text-muted-foreground tabular-nums">{n(splits.length)}</span>
      </h2>
      <ul className="mt-2 flex flex-col">
        {splits.map((split) => (
          <SplitRow key={split.name} split={split} />
        ))}
      </ul>
    </section>
  )
}

function SplitRow({ split }: { split: SplitFamily }) {
  const me = useMe()
  const domains = useDomains()
  const write = useWrite()
  const mayJoin = me.admin || (!!split.domain && me.owns.includes(split.domain))
  const joining = useReported<void>({
    wasnt: `${split.name} wasn't made one family again.`,
    done: () => toast(`${split.name} is one family again`),
  })
  const by = split.by === me.name ? 'you' : split.by
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3">
      <div className="max-w-reading min-w-0 flex-1 text-sm">
        <p className="font-medium">{split.name}</p>
        <p className="text-muted-foreground">
          {andList(split.metrics)}, split by {by} on {split.on}.{' '}
          {split.items
            ? `${n(split.items)} context ${split.items === 1 ? 'item is' : 'items are'} still about the family, due for a check.`
            : 'No context is about the family now.'}
        </p>
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
          onClick={() => joining.act(() => write('joinFamily', { name: split.name }))}
        >
          Make them one family again
        </Button>
      ) : (
        <p className="shrink-0 text-xs text-muted-foreground">
          {split.domain && domains[split.domain]
            ? `Owners of ${domains[split.domain]!.name} decide`
            : 'An admin decides'}
        </p>
      )}
    </li>
  )
}
