import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { settingSchemas } from '../../src/contract/admin.ts'
import {
  ABOUT_BUSINESS_END,
  ABOUT_BUSINESS_GUIDE,
  ABOUT_BUSINESS_MAX,
  ABOUT_BUSINESS_STARTER,
  ABOUT_GUIDE_PARTS,
  aboutByRule,
  aboutGuidePartsIn,
  aboutDraftOf,
  aboutFactsIn,
  aboutFactsMessage,
  type AboutFacts,
} from '../../src/domain/about-business.ts'

/*
  About our business starts with no text: the baseline migration writes an empty first version,
  and the setting must accept it as stored. The starter text, which the demo seeds write, must be
  one the setting accepts too. The guide is the shape of the text to fill in, never a text to
  save as it is.
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

describe('the guide', () => {
  it('is the shape of the text, with a part in brackets for each thing it says', () => {
    expect(ABOUT_BUSINESS_GUIDE).toBe(
      'We sell [what] to [whom], in [where], through [which channels].',
    )
    expect(aboutGuidePartsIn(ABOUT_BUSINESS_GUIDE)).toEqual([...ABOUT_GUIDE_PARTS])
  })

  it("names no company, least of all the demo's", () => {
    for (const word of ['outdoor', 'retailer', 'footwear', 'twelve'])
      expect(ABOUT_BUSINESS_GUIDE.toLowerCase()).not.toContain(word)
  })

  it('says which parts are still to fill in, as the editor writes them back', () => {
    expect(
      aboutGuidePartsIn(
        'We sell invoicing software to \\[whom\\], in the Nordic countries, through \\[which channels\\].',
      ),
    ).toEqual(['[whom]', '[which channels]'])
    expect(
      aboutGuidePartsIn('We sell invoicing software to small firms, through our website.'),
    ).toEqual([])
    // Brackets of the writer's own are not a part of the guide.
    expect(aboutGuidePartsIn('We sell bikes [and e-bikes] to whom it suits.')).toEqual([])
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
  }

  it('names the metrics across the domains', () => {
    expect(aboutByRule(facts)).toBe('We follow Orders and Net revenue across Sales and Marketing.')
  })

  it('says only what there is, and nothing when there is nothing', () => {
    expect(aboutByRule({ domains: facts.domains, metrics: [] })).toBe(
      'Our work is organised in Sales and Marketing.',
    )
    expect(aboutByRule({ domains: [], metrics: [] })).toBe('')
  })

  it('is one the setting accepts, however many names there are', () => {
    const many = Array.from({ length: 40 }, (_, i) => `A rather long name number ${i}`)
    const text = aboutByRule({
      domains: many.map((name) => ({ name, description: '' })),
      metrics: many.map((name) => ({ name, description: null })),
    })
    expect(settingSchemas['business.about'].safeParse(text)).toEqual({ success: true, data: text })
  })
})

describe("a model's first version", () => {
  it('reads the facts back from what the model is sent', () => {
    const facts: AboutFacts = {
      domains: [{ name: 'Sales', description: 'Orders.' }],
      metrics: [],
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
