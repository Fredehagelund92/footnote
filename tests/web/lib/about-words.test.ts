import { describe, expect, it } from 'vitest'
import { definedInAbout, definedWords } from '@/lib/about-words'
import { glossary, type Definition } from '@/lib/definitions'

/*
  About our business says what the company does; a line of it that defines a word Definitions
  already has is said under the field (FR-816), so the text never holds a second meaning.
*/

const definition = (name: string, fields: Partial<Definition> = {}): Definition => ({
  name,
  type: 'metric',
  definition: '',
  synced: true,
  tool: 'Cube',
  sourceNames: [],
  updated: '2 Oct 2026',
  ...fields,
})
const all = [
  definition('Net revenue'),
  definition('Orders'),
  definition('Store credit', { type: 'term', synced: false, tool: undefined }),
]
const { find } = glossary(all)
const names = (text: string) => definedInAbout(text, find).map((d) => d.name)

describe('the words About our business defines again', () => {
  it('names each definition a "Word: meaning" line gives again, once, in the order written', () => {
    const text = [
      'We are an outdoor-gear retailer.',
      '',
      '- **Net revenue**: after VAT.',
      '* order: a purchase a customer paid for.',
      '1. Store credit: money a customer holds with us.',
      'Net Revenue: said twice.',
    ].join('\n')
    expect(names(text)).toEqual(['Net revenue', 'Orders', 'Store credit'])
  })

  it('reads no sentence as a definition, and no word nothing defines', () => {
    expect(names('We sell gear: footwear and clothing.')).toEqual([])
    expect(names('Season: spring and summer.')).toEqual([])
    expect(names('Net revenue:')).toEqual([])
  })

  it('says where the definition is: from its tool, or a term in Definitions', () => {
    expect([...all, definition('Market', { tool: undefined })].map(definedWords)).toEqual([
      'already has a definition, from Cube.',
      'already has a definition, from Cube.',
      'is already a term in Definitions.',
      'already has a definition.',
    ])
  })
})
