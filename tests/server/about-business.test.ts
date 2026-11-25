import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { settingSchemas } from '../../src/contract/admin.ts'
import {
  ABOUT_BUSINESS_END,
  ABOUT_BUSINESS_MAX,
  ABOUT_BUSINESS_STARTER,
  aboutByRule,
  aboutDraftOf,
  aboutFactsIn,
  aboutFactsMessage,
  type AboutFacts,
} from '../../src/domain/about-business.ts'

/*
  About our business starts with no text: the baseline migration writes an empty first version,
  and the setting must accept it as stored. The starter text, which the guide offers and
  Administration's reset puts back, must be one the setting accepts too.
*/

const baseline = readFileSync(
  new URL('../../db/migrations/0001_schema.sql', import.meta.url),
  'utf8',
)

describe('the baseline migration', () => {
  it('starts the setting with no text, as the settings API keeps it', () => {
    const stored = /\('business\.about', 1, '((?:[^']|'')*)'/.exec(baseline)?.[1]
    expect(stored).toBeDefined()
    const value = JSON.parse(stored!.replaceAll("''", "'")) as unknown
    expect(value).toBe('')
    expect(settingSchemas['business.about'].safeParse(value)).toEqual({ success: true, data: '' })
  })
})

describe('the starter text', () => {
  it('is one the setting accepts as it is', () => {
    expect(settingSchemas['business.about'].safeParse(ABOUT_BUSINESS_STARTER)).toEqual({
      success: true,
      data: ABOUT_BUSINESS_STARTER,
    })
  })
})

describe('a first version by rule', () => {
  const facts: AboutFacts = {
    domains: [
      { name: 'Sales', description: 'Orders and what customers pay.' },
      { name: 'Marketing', description: '' },
    ],
    metrics: [
      { name: 'Orders', description: 'Completed and paid orders.' },
      { name: 'Net revenue', description: null },
    ],
    dimensions: [
      { name: 'Market', values: ['Germany', 'Norway', 'Sweden'] },
      { name: 'Region', values: [] },
      { name: 'Channel', values: ['Stores', 'Webshop'] },
    ],
  }

  it('names the metrics across the domains, then the dimensions with values', () => {
    expect(aboutByRule(facts)).toBe(
      'We follow Orders and Net revenue across Sales and Marketing. We work by Market (Germany, Norway and Sweden) and Channel (Stores and Webshop).',
    )
  })

  it('says only what there is, and nothing when there is nothing', () => {
    expect(aboutByRule({ domains: facts.domains, metrics: [], dimensions: [] })).toBe(
      'Our work is organised in Sales and Marketing.',
    )
    expect(aboutByRule({ domains: [], metrics: [], dimensions: [] })).toBe('')
  })

  it('is one the setting accepts, however many names there are', () => {
    const many = Array.from({ length: 40 }, (_, i) => `A rather long name number ${i}`)
    const text = aboutByRule({
      domains: many.map((name) => ({ name, description: '' })),
      metrics: many.map((name) => ({ name, description: null })),
      dimensions: many.map((name) => ({ name, values: many })),
    })
    expect(settingSchemas['business.about'].safeParse(text)).toEqual({ success: true, data: text })
  })
})

describe("a model's first version", () => {
  it('reads the facts back from what the model is sent', () => {
    const facts: AboutFacts = {
      domains: [{ name: 'Sales', description: 'Orders.' }],
      metrics: [],
      dimensions: [],
    }
    expect(aboutFactsIn(`Before ${aboutFactsMessage(facts)} after`)).toEqual(facts)
    expect(aboutFactsIn('No facts here.')).toBeNull()
  })

  it('loses its quotation marks and the line that ends the block', () => {
    expect(aboutDraftOf('"We rent bikes in three cities."')).toBe('We rent bikes in three cities.')
    expect(aboutDraftOf(`We rent bikes.\n${ABOUT_BUSINESS_END}`)).toBe('We rent bikes.')
  })

  it('is cut to the limit at the last sentence that fits, else at a whole word', () => {
    const sentence = 'We rent bikes and helmets to visitors in three cities near the sea. '
    const long = sentence.repeat(10)
    const cut = aboutDraftOf(long)
    expect([...cut].length).toBeLessThanOrEqual(ABOUT_BUSINESS_MAX)
    expect(cut).toMatch(/sea\.$/)
    const words = aboutDraftOf('word '.repeat(200))
    expect([...words].length).toBeLessThanOrEqual(ABOUT_BUSINESS_MAX)
    expect(words).toMatch(/word$/)
  })
})
