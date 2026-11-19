import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  mapDefinitions,
  semanticManifestSchema,
} from '../../../src/connectors/dbt-metricflow/mapping.ts'

/*
  The mapping on files a real `dbt parse` wrote, not the hand-made shop: dbt Labs' public
  jaffle-shop sample in the latest YAML spec, with a few `meta` keys added, parsed by dbt Core
  1.12.7 and by dbt 2.0.12 (Fusion), cut to two semantic models (tests/fixtures/dbt-metricflow/
  real/, REBUILD.md). The two write the file differently: Fusion writes `config: null` where Core
  writes `config: { meta: {} }`, lists metrics in another order and copies no semantic model's
  meta into its dimensions. What Footnote reads must not depend on which one wrote it.
*/

const read = async (writer: 'core' | 'fusion') =>
  mapDefinitions(
    semanticManifestSchema.parse(
      JSON.parse(
        await readFile(
          new URL(`../../fixtures/dbt-metricflow/real/jaffle-shop.${writer}.json`, import.meta.url),
          'utf8',
        ),
      ),
    ),
  )

const byRef = async (writer: 'core' | 'fusion') =>
  Object.fromEntries((await read(writer)).definitions.map((d) => [d.ref, d]))

describe('a semantic manifest from a real dbt parse', () => {
  it('reads every metric and dimension, whole, under both dbt Core and Fusion', async () => {
    for (const writer of ['core', 'fusion'] as const) {
      const file = await read(writer)
      expect(file.complete).toBe(true)
      expect(file.definitions.filter((d) => d.kind === 'metric')).toHaveLength(17)
      expect(file.definitions.filter((d) => d.kind === 'dimension')).toHaveLength(8)
    }
  })

  it('gives the same definitions, marks and warnings whichever dbt wrote the file', async () => {
    const [core, fusion] = [await read('core'), await read('fusion')]
    expect(fusion.definitions).toEqual(core.definitions)
    expect(fusion.warnings).toEqual(core.warnings)
  })

  it("types simple metrics by their own aggregation, as dbt's latest spec writes them with no measure", async () => {
    const d = await byRef('fusion')
    expect(d['dbt:orders.orders']?.valueType).toBe('sum')
    expect(d['dbt:order_items.median_revenue']?.valueType).toBe('median')
    expect(d['dbt:order_items.food_revenue_pct']?.valueType).toBe('ratio')
    expect(d['dbt:order_items.cumulative_revenue']?.valueType).toBe('cumulative')
    // Built on order_items' revenue and orders' cost: shared, under no one semantic model.
    expect(d['dbt:_shared.order_gross_profit']?.valueType).toBe('derived')
  })

  it("reads meta where the latest spec keeps it: the semantic model's, a dimension's and a metric's", async () => {
    const d = await byRef('fusion')
    // models[].semantic_model.config.meta.domain gives the semantic model its domain.
    expect(d['dbt:orders.order_total']?.areaHint).toBe('sales')
    // A metric's own config.meta wins, and names its other names.
    expect(d['dbt:orders.orders']).toMatchObject({
      areaHint: 'finance',
      synonyms: ['order count', 'purchases'],
    })
    // columns[].dimension: its label and its config.meta.
    expect(d['dbt:orders.ordered_at']).toMatchObject({
      title: 'Order date',
      areaHint: 'sales',
      synonyms: ['order day', 'purchase date'],
    })
    // models[].config.meta.domain (from_model_config) is dropped by dbt itself.
    expect(JSON.stringify(Object.values(d))).not.toContain('from_model_config')
  })

  it('names what it cannot give a domain, rather than guess', async () => {
    const { warnings } = await read('core')
    expect(warnings).toEqual([
      { type: 'warning', code: 'invalid_domain', target: 'orders.is_food_order' },
      { type: 'warning', code: 'missing_domain', target: '_shared.order_gross_profit' },
      { type: 'warning', code: 'missing_domain', target: 'order_items' },
    ])
  })

  it('lets no calculation, filter, database or schema cross', async () => {
    const text = JSON.stringify(await read('core'))
    for (const canary of [
      'case when',
      'product_price',
      'Dimension(',
      'example_db',
      'example_schema',
    ])
      expect(text).not.toContain(canary)
  })
})
