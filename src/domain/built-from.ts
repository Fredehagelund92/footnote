/*
  The built-from part of an answer, a lab that is off unless FOOTNOTE_LAB_BUILT_FROM=on (slice T0
  of the metric trees research): what is published about the metrics an asked metric is built
  from, as its definitions tool says, for the same dates and the same place. It stands apart from
  the answer, under its own label. The answer state and its sentence stay as they are, so a metric
  with nothing written on it is still Not found, and an item on both metrics is told once, in the
  answer. One step down only: the metrics the asked one takes, never what those take in turn.

  The lines come from the tool, read only, as `definitions.built_from_refs` (FR-143). Nobody in
  Footnote draws one. Pure: no input or output.
*/
import { noGroups } from './item.ts'
import { metricsOf, resolve, type EditionBundle, type Match } from './resolver.ts'
import { askedMetrics } from './say.ts'
import type { ResolvedScope } from './scope.ts'

/**
 * What each metric is built from, by key: the keys of the metrics its definitions take, as the
 * tool says, sorted. Only definitions every agent may read, and only metrics of the vocabulary.
 */
export type BuiltFromMap = Readonly<Record<string, readonly string[]>>

export type BuiltFromBundle = EditionBundle & {
  terms: readonly { key: string; name: string; definitionRefs?: readonly string[] }[]
  builtFrom: BuiltFromMap
}

export type BuiltFromPart = {
  /** Each asked metric that is built from others, with those others. */
  metrics: { metric: string; from: string[] }[]
  /** The items that apply to those others and are not in the answer, in the resolver's order. */
  items: { match: Match; on: string[] }[]
}

/**
 * The built-from part of the answer to `scope`: the metrics each asked metric is built from that
 * the reader may see (`shown`) and that were not asked themselves, and the published items that
 * apply to them for the same dates and values, as the resolver gives them to an agent with no
 * group, leaving out the items the answer already holds (`given`). Null when no asked metric is
 * built from another.
 */
export function builtFromPart(
  bundle: BuiltFromBundle,
  scope: ResolvedScope,
  given: ReadonlySet<string>,
  today: string,
  shown: (key: string) => boolean,
): BuiltFromPart | null {
  const asked = askedMetrics(bundle, scope)
  const opened = new Set(asked.flatMap((key) => [key, ...metricsOf(bundle, key)]))
  const metrics = asked.flatMap((metric) => {
    const from = (bundle.builtFrom[metric] ?? []).filter((key) => !opened.has(key) && shown(key))
    return from.length ? [{ metric, from: [...from] }] : []
  })
  if (!metrics.length) return null
  const inputs = [...new Set(metrics.flatMap((m) => m.from))]
  const resolution = resolve(bundle, {
    scope: { status: 'resolved', scope: { ...scope, metrics: inputs } },
    today,
    groups: noGroups,
    hiddenMetrics: [],
    sizeLimit: Number.MAX_SAFE_INTEGER,
    dependenciesAvailable: true,
  })
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  const items = resolution.items
    .filter((match) => !given.has(match.id))
    .map((match) => {
      const own = byId.get(match.id)!.scope.metrics
      const about = new Set(own.flatMap((key) => [key, ...metricsOf(bundle, key)]))
      const on = inputs.filter(
        (input) =>
          about.has(input) || (bundle.groupsOfMetric[input] ?? []).some((g) => own.includes(g)),
      )
      return { match, on }
    })
  return { metrics, items }
}

const list = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What the part says, as one paragraph: what each asked metric is built from and which tool says
 * so (`toolOf`, null when no tool describes it), how many published items apply to those, and that
 * they are about those metrics, not the one asked about, and prove no cause.
 */
export function builtFromSaid(
  part: BuiltFromPart,
  nameOf: (key: string) => string,
  toolOf: (key: string) => string | null,
): string {
  const lines = part.metrics.map(({ metric, from }) => {
    const tool = toolOf(metric)
    return `${nameOf(metric)} is built from ${list(from.map(nameOf))}, as ${tool ? `${tool} says` : 'its definition says'}.`
  })
  const n = part.items.length
  if (!n)
    return [...lines, 'Nothing published applies to those for the same dates and place.'].join(' ')
  const asked =
    part.metrics.length === 1
      ? `${nameOf(part.metrics[0]!.metric)} itself`
      : 'the metrics asked about'
  return [
    ...lines,
    `${n.toLocaleString('en')} published ${n === 1 ? 'item applies' : 'items apply'} to those for the same dates and place.`,
    `${n === 1 ? 'It is' : 'They are'} not about ${asked} and ${n === 1 ? 'proves' : 'prove'} no cause.`,
  ].join(' ')
}
