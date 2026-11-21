import { relationsOf, type RelationMember } from '@domain/definition-relations'
import { keyPart } from '@domain/term-candidates'
import type { Definition, DefinitionRelation } from '@/lib/definitions'
import { metrics } from './world'

// What the demo world's metrics are built from, as its definitions tool says it (FR-143): the
// metrics a ratio or a derived metric takes, by name, and the columns a simple one's calculation
// reads. The same names a connector sends; never a calculation.
const builtFrom: Record<string, { metrics?: string[]; columns?: string[] }> = {
  Orders: { columns: ['order_amount_eur'] },
  Returns: { columns: ['refund_amount_eur'] },
  'Net revenue': { columns: ['net_amount_eur'] },
  'Gross sales': { columns: ['gross_amount_eur'] },
  'Units sold': { columns: ['quantity'] },
  'Marketing spend': { columns: ['spend_eur'] },
  'First-time buyers': { columns: ['customer_id', 'first_paid_order_at'] },
  'Cost per acquisition': { metrics: ['Marketing spend', 'First-time buyers'] },
  'Return on ad spend': { metrics: ['Net revenue', 'Marketing spend'] },
  'Gross margin': { metrics: ['Net revenue'] },
}

const refOf = (name: string) =>
  `demo:${keyPart(metrics.find((m) => m.name === name)!.group)}.${keyPart(name)}`

const members: (RelationMember & { said: string })[] = Object.entries(builtFrom).map(
  ([name, from]) => ({
    ref: refOf(name),
    name: refOf(name).slice('demo:'.length),
    said: name,
    builtFrom: { refs: (from.metrics ?? []).map(refOf), columns: from.columns ?? [] },
  }),
)

/** A synced metric's relations as the service gives them, linked to the definitions listed. */
export function relationsFor(name: string, listed: readonly Definition[]): DefinitionRelation[] {
  const own = members.find((member) => member.said === name)
  if (!own) return []
  return relationsOf(own, members, (ref) => {
    const said = members.find((member) => member.ref === ref)?.said
    const live = said && listed.find((d) => d.synced && d.name === said)
    return live ? { name: live.name, key: ref, missing: false } : undefined
  }).map((relation) => ({
    kind: relation.kind,
    name: relation.name,
    column: relation.ref === null,
    linked: relation.key !== null,
    missing: relation.missing,
    by: relation.by,
  }))
}
