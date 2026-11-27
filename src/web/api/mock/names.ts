import type { DecideNamesInput, NamesDecision, NamesRead, WaitingValue } from '@contract/inbox'
import { contentDigest } from '@domain/canonical'
import {
  familyRead,
  mayGoApart,
  nameRefusal,
  sourceNames,
  variantNameRefusal,
  type WordHolders,
} from '@domain/source-names'
import { familiesOf, familyCounts } from '@domain/metric-families'
import { namesPlace } from '@domain/names-place'
import { memberName, type CandidateMember } from '@domain/term-candidates'
import { termName } from '@domain/terms'
import { ApiError } from '@/api/errors'
import { namesWords, type InboxCard } from '@/model/inbox'
import type { HeldDefinition } from './integrations'

// The names a read makes in the mock (FR-141): the same rules as the service, on the members of an
// invented shop's dbt project. They wait once a definitions tool is connected, or with
// ?demo=names. Accepting one takes it off the list; the mock's vocabulary is the demo's own, so
// nothing else changes. Kept until the page reloads. As on the service, a name is read and
// decided only by an admin or an owner of its domain. The values someone added in Definitions wait
// here too (values without figures): the demo's dimensions have no domain, so an admin decides. A
// new install's read (`load` with `placed` false) names no domain, as a first model seldom does, so
// the card offers one for them (F08).

/** Who reads the names: an admin, or the owner of some domains. */
type Reader = { admin: boolean; owns: readonly string[] }
/** The domains names may go under, and every id a domain has. */
type Domains = { domains: { id: string; name: string; owned: boolean }[]; taken: Set<string> }

const member = (
  name: string,
  title: string | null,
  extra: Partial<CandidateMember> = {},
): CandidateMember => ({
  ref: `dbt:${name}`,
  // The dbt project's page in Integrations, where its families are counted.
  source: 'dbt-metricflow',
  kind: 'metric',
  name,
  title,
  description: null,
  valueType: 'count',
  areaHint: 'sales',
  synonyms: [],
  baseName: null,
  mergeDimensions: 'never',
  ...extra,
})

const shop: CandidateMember[] = [
  member('orders.completed_orders', 'Completed orders', {
    description: 'Orders that were paid and sent.',
  }),
  member('orders.basket_value', 'Basket value', { description: 'Average value of an order.' }),
  member('orders.total', 'Total'),
  member('refunds.total', 'Total'),
  member('orders.ship_method', null, { kind: 'dimension', valueType: 'categorical' }),
  member('orders.paid_at', 'Paid at', { kind: 'dimension', valueType: 'time' }),
]

/** With ?demo=families: a metric per currency and channel, which the read finds as one family (FR-142). */
const variants: CandidateMember[] = [
  member('orders.currency_code', 'Currency', { kind: 'dimension', valueType: 'categorical' }),
  member('orders.channel', 'Channel', { kind: 'dimension', valueType: 'categorical' }),
  ...['EUR', 'USD', 'GBP', 'SEK'].flatMap((currency) =>
    ['web', 'app'].map((channel) =>
      member(
        `orders.packaging_costs_${currency.toLowerCase()}_${channel}`,
        `Packaging costs (${currency}) ${channel}`,
        {
          valueType: 'sum',
          description: `What boxes, fill and labels cost for orders in ${currency} via ${channel}.`,
          variant: {
            shape: 'a'.repeat(64),
            by: [
              { name: 'currency_code', ref: 'dbt:orders.currency_code', value: currency },
              { name: 'channel', ref: 'dbt:orders.channel', value: channel },
            ],
          },
        },
      ),
    ),
  ),
]

/**
 * With ?demo=families, the other two ways a family is found (D1): one the tool declares in
 * `meta.footnote`, by sales line; two pairs in EUR and USD that one rate converts, by Currency; and a
 * pair whose names alone look alike, which waits for the owner to publish as one family or apart.
 */
const declared = (line: string) =>
  member(`orders.gift_wrap_${line}`, `Gift wrap (${line})`, {
    valueType: 'sum',
    declared: { name: 'gift_wrap', by: [{ name: 'sales_line', ref: null, value: line }] },
  })
const converted = (stem: string, label: string) =>
  (['EUR', 'USD'] as const).map((code) =>
    member(`orders.${stem}_${code.toLowerCase()}`, `${label} (${code})`, {
      valueType: 'sum',
      builtFrom: {
        refs: [],
        columns: code === 'EUR' ? [`${stem}_eur`] : [`${stem}_eur`, 'exchange_rate_usd'],
      },
    }),
  )
const foundOtherwise: CandidateMember[] = [
  declared('retail'),
  declared('online'),
  ...converted('accrued_share', 'Accrued share'),
  ...converted('commission', 'Commission'),
  ...(['EUR', 'USD'] as const).map((code) =>
    member(`orders.shipping_fee_${code.toLowerCase()}`, `Shipping fee (${code})`, {
      valueType: 'sum',
    }),
  ),
]

/**
 * What Test connection finds in the shop of ?demo=families, as the service counts a test's read:
 * its metrics and dimensions, and the families of each kind the first read would find (D5).
 */
export function familiesShopRead() {
  const all = [...shop, ...variants, ...foundOtherwise]
  const metrics = all.filter((m) => m.kind === 'metric')
  const families = familyCounts(
    familiesOf(
      metrics.map((m) => ({
        ...m,
        said: memberName(m),
        variant: m.variant ?? null,
        declared: m.declared ?? null,
        builtFrom: m.builtFrom ?? null,
      })),
    ),
  )
  return {
    metrics: metrics.length,
    dimensions: all.length - metrics.length,
    ...(families ? { families } : {}),
  }
}

/** What the shop of ?demo=families holds, each in its semantic model (its name up to the dot). */
export function familiesShopHeld(): HeldDefinition[] {
  return [...shop, ...variants, ...foundOtherwise].map((m) => ({
    group: m.name.slice(0, m.name.indexOf('.')),
    kind: m.kind === 'metric' ? 'metric' : 'dimension',
    count: 1,
    domain: m.areaHint,
  }))
}

/** The words that mean something else in the mock's demo: the demo has its own Orders. */
const holders: WordHolders = new Map([
  ['basket value', [{ origin: 'vocabulary', ref: 'metric:aov', name: 'Average order value' }]],
])

export function createMockNames(
  heldWords: WordHolders = holders,
  /** Publishes values that were waiting, as an owner's decision does. */
  publish: (values: readonly WaitingValue[]) => void = () => {},
  domainsOf: (who: Reader) => Domains = () => ({ domains: [], taken: new Set() }),
) {
  let waiting = false
  let members = shop
  const taken = new Set<string>()
  const left = new Set<string>()
  let values: WaitingValue[] = []
  /** The values that wait for the person: those of a domain they own, or any for an admin. */
  const valuesFor = (who: Reader) =>
    values.filter((v) => who.admin || (v.areaId !== null && who.owns.includes(v.areaId)))

  const names = () =>
    waiting
      ? sourceNames(
          members.filter((m) => !taken.has(m.ref)),
          [],
          heldWords,
          left,
        )
      : []
  const readable = (who: Reader) =>
    names().filter((n) => who.admin || (n.areaId !== null && who.owns.includes(n.areaId)))
  /** The names with no domain, which an admin puts under one: the mock's names share no view. */
  const unplaced = (who: Reader) =>
    who.admin ? readable(who).filter((n) => n.state !== 'left_out' && n.areaId === null) : []
  const read = async (who: Reader): Promise<NamesRead> => {
    const shown = readable(who).map(
      ({
        views: _views,
        valueType: _type,
        suggested: _s,
        parentKey: _parent,
        family,
        ...name
      }) => ({
        ...name,
        tool: 'dbt',
        family: familyRead({ family, linked: name.linked }),
      }),
    )
    const shownValues = valuesFor(who)
    const place = namesPlace({
      unplaced: unplaced(who).map((n) => ({ named: null, views: n.views })),
      ...domainsOf(who),
    })
    return {
      revision: await contentDigest({ shown, values: shownValues }),
      names: shown,
      values: shownValues,
      place,
    }
  }
  return {
    /**
     * A read of a definitions tool ended; with `families`, it found a family of metrics too. With
     * `placed` false its members name no domain, as on a new install.
     */
    load: (families = false, placed = true) => {
      waiting = true
      if (families) members = [...shop, ...variants, ...foundOtherwise]
      if (!placed) members = members.map((m) => ({ ...m, areaHint: null }))
    },
    read,
    /** Values someone added in Definitions, waiting for an owner. */
    suggest(added: readonly WaitingValue[]) {
      values = [...values, ...added]
    },
    /** The values that wait, of every dimension: what a new one must not repeat. */
    waitingValues: () => values,
    card(me: string, who: Reader): InboxCard | null {
      const list = readable(who)
      const ready = list.filter((n) => n.state === 'ready').length
      const flagged = list.filter((n) => n.state === 'flagged').length
      const waitingValues = valuesFor(who).length
      if (!ready && !flagged && !waitingValues) return null
      const families = list.filter((n) => n.family && n.state !== 'left_out').length
      const counts = { ready, flagged, families, values: waitingValues, tool: 'dbt' }
      return {
        id: 'names:waiting',
        type: 'names',
        domain: 'sales',
        for: me,
        when: 'Today',
        ...namesWords(counts),
        detail: '',
        primary: 'Review',
        secondary: [],
        names: counts,
      }
    },
    /** The names published with no domain, of a decision, which go under its domain. */
    placing: (input: DecideNamesInput, who: Reader) => {
      const keys = new Set(input.accept.map((pick) => pick.key))
      return unplaced(who).filter((n) => keys.has(n.key)).length
    },
    async decide(input: DecideNamesInput, who: Reader): Promise<NamesDecision> {
      if ((await read(who)).revision !== input.revision)
        throw new ApiError('conflict', 'The names changed after you opened them.')
      const decided = input.values ?? { accept: [], leaveOut: [] }
      const mine = valuesFor(who)
      for (const id of [...decided.accept, ...decided.leaveOut])
        if (!mine.some((v) => v.id === id))
          throw new ApiError(
            'conflict',
            'A value here no longer waits. Look at the latest list, then try again.',
          )
      const found = readable(who)
      for (const key of [...input.accept.map((pick) => pick.key), ...input.leaveOut])
        if (!found.some((n) => n.key === key))
          throw new ApiError(
            'conflict',
            'A name here is no longer waiting. Look at the latest list, then try again.',
          )
      for (const { key, apart } of input.accept) {
        const waiting = found.find((n) => n.key === key)
        if (apart && !(waiting && mayGoApart(waiting)))
          throw new ApiError(
            'invalid',
            waiting?.family?.found === 'declared'
              ? `dbt declares “${waiting.name}” as one family. Keep its variants separate there.`
              : `“${waiting?.name ?? key}” is not a family waiting to be published. Publish it as it is.`,
          )
      }
      const asked = [...input.accept.map(({ key }) => key), ...input.leaveOut]
      if (new Set(asked).size !== asked.length)
        throw new ApiError('conflict', 'Publish a name or leave it out, not both.')
      // A family Footnote suggests, published apart: its variants, each by its own name.
      const apart = input.accept.flatMap(({ key, apart }) =>
        apart
          ? (found.find((n) => n.key === key)?.family?.variants ?? []).map((v) => ({
              key: v.key,
              name: v.name,
            }))
          : [],
      )
      const list = [
        ...found,
        ...found.flatMap((n) => (n.family && mayGoApart(n) ? n.family.variants : [])),
      ]
      const chosen = new Map(
        [...input.accept.filter((pick) => !pick.apart), ...apart].map(({ key, name }) => [
          key,
          termName(name ?? list.find((n) => n.key === key)?.name ?? key),
        ]),
      )
      const going = new Map(
        [...chosen].map(([key, name]) => [
          key,
          [name, ...(list.find((n) => n.key === key)?.aliases ?? [])],
        ]),
      )
      for (const [key, name] of chosen) {
        const refused = nameRefusal(key, name, heldWords, going)
        if (refused) throw new ApiError('invalid', refused)
        const family = list.find((n) => n.key === key)
        for (const variant of family?.family?.variants ?? [])
          if (nameRefusal(variant.key, variant.name, heldWords, going))
            throw new ApiError('invalid', variantNameRefusal(family!.name))
      }
      for (const key of chosen.keys())
        list
          .find((n) => n.key === key)
          ?.definitionRefs.forEach((ref) => {
            taken.add(ref)
            left.delete(ref)
          })
      for (const key of input.leaveOut)
        list.find((n) => n.key === key)?.definitionRefs.forEach((ref) => left.add(ref))
      // The first of two people's same value is published, and the other waits for nothing.
      const published = values.filter((v) => decided.accept.includes(v.id))
      publish(published)
      const settled = new Set(published.map((v) => v.key))
      values = values.filter((v) => !decided.leaveOut.includes(v.id) && !settled.has(v.key))
      return {
        edition: chosen.size || published.length ? 'today.1' : null,
        accepted: chosen.size,
        leftOut: input.leaveOut.length,
        values: { accepted: published.length, leftOut: decided.leaveOut.length },
        waiting: await read(who),
      }
    },
  }
}
