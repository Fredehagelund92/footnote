import type * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { definitionRelationsQuery } from '@/api/queries'
import { ShowMoreButton } from '@/components/footnote/show-more'
import { TypeGlyph } from '@/components/footnote/type-glyph'
import { useShowMore } from '@/hooks/use-show-more'
import type { Definition, DefinitionRelation, Family } from '@/lib/definitions'
import { foundSaid } from '@domain/family-found'

/**
 * What a synced metric is built from and what is built from it (FR-143), as its tool's structure
 * says, never words in its description: Converted from and to (D2), Built from (definitions, then
 * the columns its calculation reads) and Used by. Definitions open their pages; columns are names
 * in the tool. On the metric's own page, under its description, and nowhere in the first load.
 */
export function DefinitionRelations({ d }: { d: Definition }) {
  const relations = useQuery(definitionRelationsQuery(d.name)).data ?? []
  return <RelationList relations={relations} tool={d.tool ?? 'its tool'} />
}

export function RelationList({
  relations,
  tool,
}: {
  relations: readonly DefinitionRelation[]
  tool: string
}) {
  const of = (kind: DefinitionRelation['kind']) => relations.filter((r) => r.kind === kind)
  const convertedFrom = of('converted_from')
  const convertedTo = of('converted_to')
  const builtFrom = of('built_from')
  const usedBy = of('used_by')
  if (!relations.length) return null
  return (
    <section aria-label="How it is built" className="max-w-reading text-sm">
      <dl className="flex flex-col">
        {convertedFrom.length > 0 && (
          <Row label="Converted from">
            <Conversions relations={convertedFrom} tool={tool} />
          </Row>
        )}
        {convertedTo.length > 0 && (
          <Row label="Converted to">
            <Conversions relations={convertedTo} tool={tool} />
          </Row>
        )}
        {builtFrom.length > 0 && (
          <Row label="Built from">
            <Names relations={builtFrom} tool={tool} />
          </Row>
        )}
        {usedBy.length > 0 && (
          <Row label="Used by">
            <Names relations={usedBy} tool={tool} />
          </Row>
        )}
      </dl>
    </section>
  )
}

/** One row of what it is built from: its label beside the first line of what wraps. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-(--cols-lead-30) items-start gap-2 sm:grid-cols-(--cols-lead-36)">
      <dt className="pt-1.5 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col">{children}</dd>
    </div>
  )
}

/** Each conversion on a line of its own: the other metric, and the column it is converted by. */
function Conversions({ relations, tool }: { relations: DefinitionRelation[]; tool: string }) {
  return relations.map((r) => (
    <span key={r.name} className="flex min-w-0 flex-wrap items-center gap-1.5 py-1">
      <Name r={r} tool={tool} />
      {r.by && (
        <span className="text-muted-foreground">
          by the column <Column name={r.by} />
        </span>
      )}
    </span>
  ))
}

/**
 * How a family was found and how its variants are worked out from one another (FR-142, D1, D2):
 * declared in its tool, from the calculation, or from names an owner made one family; and each
 * variant converted from another, by the column. On the family's own page, under its meaning.
 */
export function FamilyRelations({
  family,
  tool,
  action,
  note,
}: {
  family: Family
  tool: string
  /** What the person can do to the family, beside how it was found: Split. */
  action?: React.ReactNode
  /** What follows how it was found: who decides whether it is one family. */
  note?: string | null
}) {
  const found = foundSaid(family.found, tool)
  const conversions = family.conversions ?? []
  // A variant by what tells it apart, as its family lists it ("USD"), else by its name.
  const said = (name: string) =>
    family.variants.find((v) => v.name === name)?.values.join(' ') || name
  if (!found && !conversions.length && !action) return null
  return (
    <section aria-label="How it is built" className="max-w-reading text-sm">
      <dl className="flex flex-col">
        {(found || action) && (
          <Row label="Family">
            <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-1">
              <span className="min-w-40 flex-1">
                {found && `${found}.`}
                {note && ` ${note}`}
              </span>
              {action}
            </span>
          </Row>
        )}
        {conversions.length > 0 && (
          <Row label="Converted">
            {conversions.map((c) => (
              <span key={c.to} className="flex min-w-0 flex-wrap items-center gap-1.5 py-1">
                <span className="font-medium">{said(c.to)}</span>
                <span className="text-muted-foreground">from</span>
                <span className="font-medium">{said(c.from)}</span>
                <span className="text-muted-foreground">
                  by the column <Column name={c.by} />
                </span>
              </span>
            ))}
          </Row>
        )}
      </dl>
    </section>
  )
}

/** Definitions first, then the columns, said once: "columns" before their names. */
function Names({ relations, tool }: { relations: DefinitionRelation[]; tool: string }) {
  const { shown, more, next, showMore } = useShowMore(relations, 12, 50)
  const columns = shown.filter((r) => r.column)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5 py-1">
      {shown
        .filter((r) => !r.column)
        .map((r) => (
          <Name key={r.name} r={r} tool={tool} />
        ))}
      {columns.length > 0 && (
        <span className="text-muted-foreground">{columns.length === 1 ? 'column' : 'columns'}</span>
      )}
      {columns.map((r) => (
        <Column key={r.name} name={r.name} />
      ))}
      <ShowMoreButton more={more} next={next} onClick={showMore} className="h-6 px-1.5" />
    </span>
  )
}

const chip =
  'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md border px-1.5 text-xs'

/** A definition: a link to its page when Definitions lists it, else its name in the tool. */
function Name({ r, tool }: { r: DefinitionRelation; tool: string }) {
  if (r.linked && !r.missing)
    return (
      <a
        href={`/definitions/${encodeURIComponent(r.name)}`}
        className={`${chip} font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50`}
      >
        <TypeGlyph d={{ type: 'metric' }} />
        <span className="truncate">{r.name}</span>
      </a>
    )
  return (
    <span className={`${chip} border-dashed text-muted-foreground`}>
      <TypeGlyph d={{ type: 'metric' }} />
      <span className="truncate">{r.name}</span>
      {r.missing && <span className="shrink-0">- no longer in {tool}</span>}
    </span>
  )
}

/** A column of the metric's view, by its name in the tool. */
function Column({ name }: { name: string }) {
  return (
    <code className="inline-flex min-h-6 max-w-full items-center rounded-md bg-muted px-1.5 font-mono text-xs break-all text-foreground">
      {name}
    </code>
  )
}
