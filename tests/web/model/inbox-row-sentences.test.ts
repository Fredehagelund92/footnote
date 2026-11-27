import { describe, expect, it } from 'vitest'
import { askedWords, changeWords, flagRowWords, gapRowWords } from '@/model/review'
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

  it('says on a Not found row when someone told the owners from Ask, and what agents found', () => {
    expect(gapRowWords({ times: 0, told: 0 })).toBe(
      'Agents found nothing, and did not ask this week.',
    )
    expect(gapRowWords({ times: 0, told: 1 })).toBe('Someone in Ask found nothing and told you.')
    expect(gapRowWords({ times: 0, told: 3 })).toBe(
      'People in Ask found nothing and told you, 3 times this week.',
    )
    expect(gapRowWords({ times: 9, told: 1 })).toBe(
      'Agents asked about this 9 times this week. They found nothing. Someone in Ask told you too.',
    )
    // A count under the minimum is hidden, never none: the card was raised by what agents asked.
    expect(gapRowWords({ times: null, told: 0 })).toBe(
      'Agents asked about this fewer than 5 times this week. They found nothing.',
    )
    expect(gapRowWords({ times: 9, told: 0, acrossMonths: 'x' })).toBe(
      'Agents asked about this 9 times this week. They found nothing. Counted across two months.',
    )
  })

  it('quotes the words of a report, and writes no empty quotes when it has none', () => {
    expect(flagRowWords({ reason: 'wrong', note: 'The source link opens the wrong page.' })).toBe(
      'Reported as wrong: “The source link opens the wrong page.”',
    )
    // It once read: Reported as wrong: “”.
    expect(flagRowWords({ reason: 'wrong', note: '' })).toBe('Reported as wrong')
    expect(flagRowWords({ reason: 'unclear', note: '  ' })).toBe('Reported as unclear')
  })

  it('names new metrics and dimensions, not "names"', () => {
    expect(namesWords({ ready: 3, flagged: 2, tool: 'Cube' }).title).toBe(
      '5 new metrics and dimensions from Cube',
    )
    // Families are counted apart from the single names (D1).
    expect(namesWords({ ready: 35, flagged: 8, families: 37, tool: 'dbt' }).title).toBe(
      '37 families and 6 names from dbt',
    )
    expect(namesWords({ ready: 1, flagged: 0, families: 1, tool: 'dbt' }).title).toBe(
      '1 family from dbt',
    )
    expect(cardTypeLabel.names).toBe('New metrics and dimensions')
  })
})
