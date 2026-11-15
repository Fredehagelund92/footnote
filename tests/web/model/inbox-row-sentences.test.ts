import { describe, expect, it } from 'vitest'
import { askedWords, changeWords } from '@/model/review'
import { cardTypeLabel, namesWords } from '@/model/inbox'

// The Inbox's suggestion rows say what happened in whole short sentences, not in labels
// ("2 wording, 2 links - 12 questions").

describe('a suggestion row in sentences', () => {
  it('says what changed with a verb and a noun', () => {
    expect(
      changeWords([
        { kind: 'Wording', n: 2 },
        { kind: 'Link', n: 2 },
      ]),
    ).toBe('changed 2 sentences and 2 links')
    expect(changeWords([{ kind: 'Order', n: 1 }])).toBe('moved 1 paragraph')
    expect(
      changeWords([
        { kind: 'Wording', n: 1 },
        { kind: 'Order', n: 3 },
      ]),
    ).toBe('changed 1 sentence and moved 3 paragraphs')
  })

  it('says how often agents asked, in a sentence', () => {
    expect(askedWords(12)).toBe('Agents asked about this 12 times this week.')
    expect(askedWords(1)).toBe('Agents asked about this once this week.')
  })

  it('names new metrics and dimensions, not "names"', () => {
    expect(namesWords({ ready: 3, flagged: 2, tools: ['Cube'] }).title).toBe(
      '5 new metrics and dimensions from Cube',
    )
    expect(cardTypeLabel.names).toBe('New metrics and dimensions')
  })
})
