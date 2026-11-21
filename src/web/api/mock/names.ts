import type { DecideNames, NamesDecision, NamesRead } from '@contract/inbox'
import { contentDigest } from '@domain/canonical'
import {
  nameRefusal,
  sourceNames,
  variantNameRefusal,
  type WordHolders,
} from '@domain/source-names'
import type { CandidateMember } from '@domain/term-candidates'
import { termName } from '@domain/terms'
import { ApiError } from '@/api/errors'
import { namesWords, type InboxCard } from '@/model/inbox'

// The names a read makes in the mock (FR-141): the same rules as the service, on the members of an
// invented shop's dbt project. They wait once a definitions tool is connected, or with
// ?demo=names. Accepting one takes it off the list; the mock's vocabulary is the demo's own, so
// nothing else changes. Kept until the page reloads.

const member = (
  name: string,
  title: string | null,
  extra: Partial<CandidateMember> = {},
): CandidateMember => ({
  ref: `dbt:${name}`,
  source: 'dbt',
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

/** The words that mean something else in the mock's demo: the demo has its own Orders. */
const holders: WordHolders = new Map([
  ['basket value', [{ origin: 'vocabulary', ref: 'metric:aov', name: 'Average order value' }]],
])

export function createMockNames(heldWords: WordHolders = holders) {
  let waiting = false
  let members = shop
  const taken = new Set<string>()
  const left = new Set<string>()

  const names = () =>
    waiting
      ? sourceNames(
          members.filter((m) => !taken.has(m.ref)),
          [],
          heldWords,
          left,
        )
      : []
  const read = async (): Promise<NamesRead> => {
    const shown = names().map(
      ({
        source: _source,
        views: _views,
        valueType: _type,
        suggested: _s,
        parentKey: _parent,
        family,
        ...name
      }) => ({
        ...name,
        tool: 'dbt',
        family: family
          ? {
              variants: family.variants.length,
              by: family.by,
              found: family.found,
              names:
                family.found === 'names' && !name.linked.length
                  ? family.variants.map((variant) => variant.name)
                  : [],
            }
          : null,
      }),
    )
    return { revision: await contentDigest(shown), names: shown }
  }
  return {
    /** A read of a definitions tool ended; with `families`, it found a family of metrics too. */
    load: (families = false) => {
      waiting = true
      if (families) members = [...shop, ...variants, ...foundOtherwise]
    },
    read,
    card(me: string): InboxCard | null {
      const list = names()
      const ready = list.filter((n) => n.state === 'ready').length
      const flagged = list.filter((n) => n.state === 'flagged').length
      if (!ready && !flagged) return null
      const counts = { ready, flagged, tools: ['dbt'] }
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
    async decide(input: DecideNames): Promise<NamesDecision> {
      if ((await read()).revision !== input.revision)
        throw new ApiError('conflict', 'The names changed after you opened them.')
      const found = names()
      for (const { key, apart } of input.accept) {
        const waiting = found.find((n) => n.key === key)
        if (apart && (waiting?.family?.found !== 'names' || waiting.linked.length))
          throw new ApiError(
            'invalid',
            `“${waiting?.name ?? key}” is not a family of names that look alike. Publish it as it is.`,
          )
      }
      const asked = [...input.accept.map(({ key }) => key), ...input.leaveOut]
      if (new Set(asked).size !== asked.length)
        throw new ApiError('conflict', 'Publish a name or leave it out, not both.')
      // A family the names alone suggest, published apart: its variants, each by its own name.
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
        ...found.flatMap((n) => (n.family?.found === 'names' ? n.family.variants : [])),
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
      return {
        edition: chosen.size ? 'today.1' : null,
        accepted: chosen.size,
        leftOut: input.leaveOut.length,
        waiting: await read(),
      }
    },
  }
}
