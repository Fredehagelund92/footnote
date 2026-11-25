import { relationsOf, treeOf, type RelationMember } from '@domain/definition-relations'
import { keyPart } from '@domain/term-candidates'
import type { BuiltFromMetric, Definition, DefinitionRelation } from '@/lib/definitions'
import { metrics } from './world'

// What the demo world's metrics are built from, as its definitions tool says it (FR-143): the
// metrics a ratio or a derived metric takes, by name, and the columns a simple one's calculation
// reads. The same names a connector sends; never a calculation.
const builtFrom: Record<string, { metrics?: string[]; columns?: string[] }> = {
  Orders: { columns: ['order_amount_eur'] },
  Returns: { columns: ['refund_amount_eur'] },
  'Net revenue': { metrics: ['Gross sales', 'Returns', 'Discount cost'] },
  'Gross sales': { columns: ['gross_amount_eur'] },
  'Units sold': { columns: ['quantity'] },
  'Marketing spend': { columns: ['spend_eur'] },
  'First-time buyers': { columns: ['customer_id', 'first_paid_order_at'] },
  'Cost per acquisition': { metrics: ['Marketing spend', 'First-time buyers'] },
  'Return on ad spend': { metrics: ['Net revenue', 'Marketing spend'] },
  'Gross margin': { metrics: ['Net revenue'] },
  'Units per order': { metrics: ['Units sold', 'Orders'] },
}

const refOf = (name: string) =>
  `demo:${keyPart(metrics.find((m) => m.name === name)!.group)}.${keyPart(name)}`

// Every metric of the world, each with what it is built from when its tool says.
const members: (RelationMember & { said: string })[] = metrics.map(({ name }) => {
  const from = builtFrom[name]
  return {
    ref: refOf(name),
    name: refOf(name).slice('demo:'.length),
    said: name,
    builtFrom: from ? { refs: (from.metrics ?? []).map(refOf), columns: from.columns ?? [] } : null,
  }
})

/** How the person sees a metric at the other end: by its name in Definitions, when listed. */
const targetIn = (listed: readonly Definition[]) => (ref: string) => {
  const said = members.find((member) => member.ref === ref)?.said
  const live = said && listed.find((d) => d.synced && d.name === said)
  return live ? { name: live.name, key: ref, missing: false } : undefined
}

/** A synced metric's relations as the service gives them, linked to the definitions listed. */
export function relationsFor(name: string, listed: readonly Definition[]): DefinitionRelation[] {
  const own = members.find((member) => member.said === name)
  if (!own) return []
  return relationsOf(own, members, targetIn(listed)).map((relation) => ({
    kind: relation.kind,
    name: relation.name,
    column: relation.ref === null,
    linked: relation.key !== null,
    missing: relation.missing,
    by: relation.by,
  }))
}

/** What a synced metric is built from at every depth, as the service gives it; none for others. */
export function builtFromFor(name: string, listed: readonly Definition[]): BuiltFromMetric[] {
  const own = members.find((member) => member.said === name)
  if (!own) return []
  return treeOf(own, members, targetIn(listed)).map((metric) => ({
    ref: metric.ref,
    name: metric.name,
    linked: metric.key !== null,
    missing: metric.missing,
    from: metric.from,
  }))
}
