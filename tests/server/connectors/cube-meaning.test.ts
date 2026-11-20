import { describe, expect, it } from 'vitest'
import { compiledMeaning } from '../../../src/connectors/cube/meaning.ts'
import { meaningMark } from '../../../src/domain/definition-helpers.ts'

/*
  Mark version 2 hashes what a compiled Cube member means, not all the compiler keeps on it, so a
  compiler upgrade that adds a field of its own changes no mark (CON-116). The members here are the
  demo model's `revenue.net_revenue` as Cube 1.7.39 and 1.8.27 compile it: 1.8 adds `included`.
*/

const sql = 'function anonymous(revenue_facts\n) {\nreturn `${revenue_facts.net_revenue}`;\n}'
const compiled1739 = {
  aggType: 'sum',
  aliasMember: 'revenue_facts.net_revenue',
  description: 'Gross sales after returns, discounts, VAT and payment fees, in euros.',
  format: null,
  meta: null,
  ownedByCube: false,
  sql,
  title: 'Net revenue',
  type: 'number',
}
const compiled1827 = { ...compiled1739, included: true }
// The worker hashes empty parts too.
const mark = (member: Record<string, unknown>) =>
  meaningMark(compiledMeaning(member), { keepEmpty: true })

describe('the meaning of a compiled Cube member', () => {
  it('gives Cube 1.7.39 and 1.8.27 the same mark, as the next compiler bump will', async () => {
    expect(await mark(compiled1827)).toBe(await mark(compiled1739))
    // A field a later compiler adds for itself changes nothing either.
    expect(await mark({ ...compiled1827, resolvedAt: 'compile', ownedByCube: true })).toBe(
      await mark(compiled1739),
    )
    // Other names and display hints say nothing about what the member means.
    expect(
      await mark({ ...compiled1739, aliases: ['turnover'], links: [], enableSuggestions: true }),
    ).toBe(await mark(compiled1739))
  })

  it('keeps the calculation, type, words and metadata', async () => {
    for (const changed of [
      { sql: sql.replace('net_revenue', 'gross_sales') },
      { aggType: 'avg' },
      { type: 'string' },
      { title: 'Revenue' },
      { description: 'Revenue after refunds.' },
      { format: 'currency' },
      { meta: { ai_context: 'Monthly close only' } },
      { aliasMember: 'revenue_facts.gross_sales' },
      { filters: [{ sql: '() => `paid`' }] },
      { rollingWindow: { trailing: '7 day' } },
    ])
      expect(await mark({ ...compiled1739, ...changed }), JSON.stringify(changed)).not.toBe(
        await mark(compiled1739),
      )
  })
})
