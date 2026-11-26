import { describe, expect, it } from 'vitest'
import { WORDS } from '@/lib/help-content'
import { kindHint } from '@/model/items'
import { definitionsStep } from '@/lib/setup'

// A word is explained where it is first used (language audit L10, G2 to G33): the setup step that
// puts the names under the first domain, the hint for a metric, and the Words list at the top of
// Help.

const wordOf = (word: string) => WORDS.find(([w]) => w === word)![1]

describe('the first screens', () => {
  it('explain a domain in its setup step and keep definition out of the kind hint', () => {
    expect(definitionsStep(null, 3, { id: null, name: 'Revenue' }).description).toMatch(
      /A domain is a part of the business with an owner\.$/,
    )
    expect(kindHint.note).not.toMatch(/definition/)
  })

  it('give Help’s Words the metric, dimension, term and Don’t conclude lines', () => {
    const definition = wordOf('Definition')
    expect(definition).toContain('A metric is a number you track, such as Orders.')
    expect(definition).toContain('A dimension is a way to split a number, such as by market.')
    expect(definition).toContain('A term is a word your company uses, such as Peak season')
    expect(wordOf("Don't conclude")).toContain(
      'Example: do not say the customs rule caused the drop.',
    )
  })
})
