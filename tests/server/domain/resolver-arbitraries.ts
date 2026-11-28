import fc from 'fast-check'
import type { EditionBundle, ResolverItem } from '../../../src/domain/resolver.ts'
import { shiftDate } from '../../../src/domain/validity.ts'
import { bundle, event, request } from './fixtures.ts'

/*
  Boundary-heavy bundles and requests for the resolver's property tests: eight items or fewer on
  two metrics and a group, two values of each of two dimensions (market and channel), eleven days,
  every risk, flag, status and stop switch. No dimension is special, so an item and a question
  name values of either or both. The resolver's and the answer engine's property tests share them,
  so both meet the same cases.
*/
export const day = (offset: number) => shiftDate('2026-08-01', offset)
const metric = fc.constantFrom('metric:orders', 'metric:revenue', 'group:payments')
const values = fc.uniqueArray(
  fc.constantFrom(
    'val:market/norway',
    'val:market/spain',
    'val:channel/email',
    'val:channel/organic',
  ),
  { maxLength: 3 },
)
/** `val:market/norway` is a value of `dim:market`. */
const dimensionOf = (value: string) => `dim:${value.slice(4, value.indexOf('/'))}`
export const itemArb = fc.record({
  start: fc.integer({ min: 0, max: 10 }),
  length: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  metrics: fc.uniqueArray(metric, { maxLength: 2 }),
  values,
  // Dimensions with any value, each only when the item lists no value of it (FR-126).
  anyValue: fc.uniqueArray(fc.constantFrom('dim:market', 'dim:channel', 'dim:product'), {
    maxLength: 2,
  }),
  riskLevel: fc.constantFrom('low' as const, 'normal' as const, 'high' as const),
  checkFlag: fc.constantFrom(null, 'needs_check' as const, 'source_missing' as const),
  status: fc.constantFrom('accepted' as const, 'retired' as const, 'proposal' as const),
  areaId: fc.constantFrom('finance', 'operations'),
  review: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
  restricted: fc.boolean(),
  summary: fc.string({ minLength: 1, maxLength: 20 }),
  conflicts: fc.uniqueArray(fc.integer({ min: 0, max: 7 }), { maxLength: 3 }),
})
export const bundleArb = fc
  .record({
    items: fc.array(itemArb, { maxLength: 8 }),
    all: fc.boolean(),
    areas: fc.uniqueArray(fc.constantFrom('finance', 'operations')),
    stopped: fc.uniqueArray(fc.integer({ min: 0, max: 7 })),
    // Half the editions stop nothing: a held-back match makes an answer Partial, so without them
    // an answer would almost never be Checked.
    quiet: fc.boolean(),
  })
  .map((value): EditionBundle =>
    bundle(
      value.items.map((row, i): ResolverItem =>
        event({
          id: `itm_0000000${i}`,
          areaId: row.areaId,
          scope: {
            metrics: row.metrics,
            dimensions: row.anyValue.filter(
              (dimension) => !row.values.some((value) => dimensionOf(value) === dimension),
            ),
            dimensionValues: row.values.map((value) => ({ dimension: dimensionOf(value), value })),
          },
          validity: {
            start: day(row.start),
            end: row.length === null ? null : day(row.start + row.length),
          },
          riskLevel: row.riskLevel,
          checkFlag: row.checkFlag,
          status: row.status,
          summary: row.summary,
          reviewDate: row.review === null ? null : day(row.review),
          audience: row.restricted ? { kind: 'groups', groups: ['finance'] } : { kind: 'everyone' },
          conflicts: row.conflicts.map((i) => `itm_0000000${i}`),
        }),
      ),
      {
        stopped: value.quiet
          ? { all: false, areas: [], items: [] }
          : {
              all: value.all,
              areas: value.areas,
              items: value.stopped.map((i) => `itm_0000000${i}`),
            },
      },
    ),
  )
export const requestArb = fc
  .record({
    metrics: fc.uniqueArray(metric),
    values,
    // The dimensions the question names with no value, for every value of each.
    every: fc.uniqueArray(fc.constantFrom('dim:market', 'dim:channel', 'dim:product')),
    start: fc.integer({ min: 0, max: 10 }),
    length: fc.integer({ min: 1, max: 10 }),
    today: fc.integer({ min: 0, max: 20 }),
    sizeLimit: fc.integer({ min: 0, max: 100 }),
    member: fc.boolean(),
    hidden: fc.boolean(),
    preview: fc.boolean(),
  })
  .map((row) =>
    request({
      scope: {
        status: 'resolved',
        scope: {
          metrics: row.metrics,
          filters: {
            ...Object.fromEntries(row.every.map((dimension) => [dimension, []])),
            ...Object.fromEntries(
              [...new Set(row.values.map(dimensionOf))].map((dimension) => [
                dimension,
                row.values.filter((value) => dimensionOf(value) === dimension),
              ]),
            ),
          },
          window: { start: day(row.start), end: day(row.start + row.length) },
        },
      },
      today: day(row.today),
      sizeLimit: row.sizeLimit,
      groups: row.member ? ['finance'] : [],
      hiddenMetrics: row.hidden ? ['metric:orders'] : [],
      ...(row.preview
        ? { preview: { personId: 'alice', ownerAreas: [], administrator: false, testRun: false } }
        : {}),
    }),
  )
