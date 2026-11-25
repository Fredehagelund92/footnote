import { describe, expect, it } from 'vitest'
import { byteSize, createToolService } from '../../../src/server/mcp/service.ts'
import type { EditionSource, ServingBundle } from '../../../src/server/modules/editions/index.ts'
import { UTC_CALENDAR } from '../../../src/domain/dates.ts'
import { memoryStore, withOrderShare as withShare } from './fixtures.ts'

/*
  The built-from lab in get_context (FOOTNOTE_LAB_BUILT_FROM): on, the reply also tells what is
  published about the metrics an asked one is built from, as built_from; the rest of the reply,
  its answer state and its sentence included, is the reply the lab off gives.
*/

const principal = {
  client: 'claude-code',
  scopes: ['read'],
  caller: 'agent',
  canSelectEdition: false,
} as const

function service(data: ServingBundle, builtFrom: boolean) {
  const source: EditionSource = {
    bundle: () => Promise.resolve(data),
    policy: () => Promise.reject(new Error('unused')),
  }
  const execute = createToolService(
    source,
    memoryStore().store,
    () => new Date('2026-10-07T12:34:56Z'),
    undefined,
    null,
    'agent',
    { builtFrom },
  )
  return async (input: object, maxBytes = 100000) => {
    const reply = await execute(
      'get_context',
      input,
      principal,
      maxBytes,
      () => {},
      () => {},
      UTC_CALENDAR,
    )
    return { reply, body: reply.structuredContent }
  }
}
const withoutId = ({ reply_id: _id, ...rest }: Record<string, unknown>) => rest

describe('the built-from lab in get_context', () => {
  const data = withShare()

  it('tells the item on what the metric is built from apart, and keeps the answer Not found', async () => {
    const question = { question: 'Order share Norway August 2026' }
    const off = (await service(data, false)(question)).body
    const on = (await service(data, true)(question)).body
    expect(off).not.toHaveProperty('built_from')
    expect(on.status).toBe('no_match')
    const { built_from: part, ...rest } = withoutId(on)
    expect(rest).toEqual(withoutId(off))
    expect(part).toMatchObject({
      say: 'Order share is built from Orders, as Cube says. 1 published item applies to those for the same dates and place. It is not about Order share itself and proves no cause.',
      metrics: [{ metric: 'Order share', from: ['Orders'] }],
      context: [{ id: 'itm_norway01', title: 'Norway closure', on: ['Orders'], match: 'exact' }],
    })
  })

  it('gives the full reply the same part', async () => {
    const on = (
      await service(
        data,
        true,
      )({
        question: 'Order share Norway August 2026',
        response_format: 'full',
      })
    ).body
    expect(on.built_from).toMatchObject({ context: [{ id: 'itm_norway01', on: ['Orders'] }] })
  })

  it('adds nothing for a metric built from nothing', async () => {
    const { body } = await service(data, true)({ question: 'Orders Norway August 2026' })
    expect(body).not.toHaveProperty('built_from')
  })

  it('lets the part go first when the reply cannot fit, never an item of the answer', async () => {
    const shared = withShare(true)
    const question = { question: 'Order share Norway August 2026' }
    const whole = await service(shared, true)(question)
    expect((whole.body.context as { id: string }[]).map((c) => c.id)).toEqual(['itm_share001'])
    expect(whole.body.built_from).toMatchObject({ context: [{ id: 'itm_norway01' }] })
    const tight = await service(shared, true)(question, byteSize(whole.reply) - 1)
    expect((tight.body.context as { id: string }[]).map((c) => c.id)).toEqual(['itm_share001'])
    expect(tight.body.built_from).toMatchObject({ context: [], more: 1 })
  })

  it('never costs the answer anything: at the limit the lab off fits, the reply is the same', async () => {
    const shared = withShare(true)
    const question = { question: 'Order share Norway August 2026' }
    const off = await service(shared, false)(question)
    const on = await service(shared, true)(question, byteSize(off.reply))
    expect(on.reply.isError).toBeFalsy()
    expect(on.body.context).toEqual(off.body.context)
    expect(on.body).not.toHaveProperty('built_from')
  })

  it('says where an item of the part applies to some values only, concise or full', async () => {
    for (const response_format of ['concise', 'full'] as const) {
      const { body } = await service(
        data,
        true,
      )({
        question: 'Order share August 2026',
        response_format,
      })
      expect(body.built_from).toMatchObject({
        context: [{ id: 'itm_norway01', match: 'partial' }],
      })
      const [entry] = (body.built_from as { context: { applies_note?: string }[] }).context
      expect(entry?.applies_note).toMatch(/^Applies to .*only\.$/)
    }
  })
})
