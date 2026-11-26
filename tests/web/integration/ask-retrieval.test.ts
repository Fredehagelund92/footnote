import { beforeAll, describe, expect, it } from 'vitest'
import type { AskToolName, AskTools } from '../../../src/server/modules/answer/index.ts'
import { askWorld } from './ask-world.ts'

/*
  How Ask's reads find what a person's words are about when no name says it, on the demo week with
  invented words in two definitions: Cost per acquisition's description defines "Orders-CPA" and
  "Returns-CPA", and Returns' says it is booked from "the clearing account". A word joined to a
  name by a hyphen is a word of its own, a definition is found by the words of its description
  when no name finds it, and a wider search tries each other name on its own. No model is called.
*/

const world = askWorld()

beforeAll(async () => {
  await world.client.query('update definitions set description_copy = $2 where ref = $1', [
    'cube:marketing.cost_per_acquisition',
    '**Orders-CPA** is marketing spend divided by first-time buyers in the same period, in euros. Distinct from **Returns-CPA**, which divides by first-time buyers who kept their first order.',
  ])
  await world.client.query(
    "update definitions set description_copy = description_copy || ' Booked from the clearing account each night.' where ref = $1",
    ['cube:orders.returns'],
  )
})

/** A tool's result that must not be an error. */
async function ok<N extends AskToolName>(tools: AskTools, name: N, input: object) {
  const result = await tools.run(name, input)
  if ('error' in result && typeof result.error === 'string' && !('found' in result))
    throw new Error(`${name} failed: ${result.error}`)
  return result as Exclude<typeof result, { error: string; ids: string[] }>
}

describe('a definition found by the words of its description', () => {
  it('is found when no name finds it, and says it was found in its text', async () => {
    await world.withTools('Jon Abara', async (tools) => {
      const clearing = await ok(tools, 'definitions', { names: ['clearing account'] })
      expect(clearing.definitions.map((d) => [d.name, d.mentions])).toEqual([
        ['Returns', 'clearing account'],
      ])
      expect(clearing.notFound).toEqual([])
      // The hyphenated names live only in Cost per acquisition's words.
      const cpa = await ok(tools, 'definitions', { names: ['Orders-CPA', 'Returns-CPA'] })
      expect(cpa.definitions.map((d) => [d.name, d.mentions])).toEqual([
        ['Cost per acquisition', 'Orders-CPA'],
      ])
      expect(cpa.notFound).toEqual([])
      // A name finds what goes by it, never what only mentions it.
      const orders = await ok(tools, 'definitions', { names: ['Orders'] })
      expect(orders.definitions.map((d) => [d.name, d.mentions])).toEqual([['Orders', undefined]])
      // A piece of a word is no whole word: it stays not found.
      const clear = await ok(tools, 'definitions', { names: ['clear'] })
      expect([clear.found, clear.notFound.map((n) => n.name)]).toEqual([0, ['clear']])
    })
  })

  it('is given by a search whose words name nothing, marked the same way', async () => {
    await world.withTools('Jon Abara', async (tools) => {
      const found = await ok(tools, 'find_context', { words: 'clearing account' })
      expect(found.definitions.map((d) => [d.name, d.inPart, d.mentions])).toEqual([
        ['Returns', false, 'clearing account'],
      ])
      // Words that name a definition give it, and no other that only mentions them.
      const named = await ok(tools, 'find_context', { words: 'returns' })
      expect(named.definitions.map((d) => [d.name, d.mentions])).toEqual([['Returns', undefined]])
    })
  })
})

describe('a word joined to a name by a hyphen', () => {
  it('reads neither name in it, so no other metric answers for it', async () => {
    await world.withTools('Jon Abara', async (tools) => {
      const read = await ok(tools, 'get_context', {
        about: 'Orders-CPA and Returns-CPA',
        no_period: true,
      })
      // On main this read Orders and Returns, and the Orders items' disagreement said Conflict.
      expect(read.read?.names ?? []).not.toContain('Orders')
      expect(read.read?.names ?? []).not.toContain('Returns')
      expect(read.state).not.toBe('conflict')
      const search = await ok(tools, 'find_context', { words: 'Orders-CPA' })
      expect(search.searched[0]!.names).toEqual([])
    })
  })

  it('still reads a name that is itself a compound', async () => {
    await world.withTools('Jon Abara', async (tools) => {
      const read = await ok(tools, 'get_context', { about: 'first-time buyers', no_period: true })
      expect(read.read?.names).toEqual(['First-time buyers'])
    })
  })
})

describe('a wider search by other names', () => {
  it('tries each other name on its own, and finds what any of them finds', async () => {
    await world.withTools('Jon Abara', async (tools) => {
      // One phrase of them all needs every word, and no item says both.
      const phrase = await ok(tools, 'find_context', { words: 'bookkeeping regulator' })
      expect(phrase.everyWord).toBe(0)
      const wider = await ok(tools, 'find_context', {
        words: 'accounting',
        widen: { other_words: ['bookkeeping', 'regulator'] },
      })
      expect(wider.widened).toBe('searched wider')
      expect(wider.searched.map((s) => [s.words, s.found > 0])).toEqual([
        ['accounting', false],
        ['bookkeeping', false],
        ['regulator', true],
      ])
      // What it finds is what the one other name that found anything finds on its own.
      const regulator = await ok(tools, 'find_context', { words: 'regulator' })
      expect(wider.everyWord).toBe(regulator.everyWord)
      expect(wider.items.map((i) => i.id)).toEqual(regulator.items.map((i) => i.id))
      expect(wider.nothing).toBeNull()
    })
  })
})
