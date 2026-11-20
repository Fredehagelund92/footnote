import { describe, expect, it } from 'vitest'
import { facts } from '@/api/mock/data/world'
import { answeredOn, cardFooter, slackText, stateLineOf } from '@/lib/share'
import type { Answer } from '@/model/ask'

const answers: Record<string, Answer> = {
  grounded: {
    id: 'grounded',
    question: 'Why did orders in Norway drop in August?',
    metric: 'Orders',
    markets: ['Norway'],
    state: 'grounded',
    text: "Online sales to Norway stopped on 4 August 2026 under a new customs rule, and there are no stores there [1]. Price promotions in Norway have been paused since 9 May 2026 [2]. The context doesn't say how much each of these moved orders.",
    sources: ['itm_norway_stop', 'itm_za26xpzv'],
    said: '',
  },
  missing: {
    id: 'missing',
    question: 'How did orders in Spain change in October 2026?',
    metric: 'Orders',
    markets: ['Spain'],
    state: 'missing',
    text: 'Nothing written covers Orders and Spain.',
    sources: [],
    said: '',
  },
}
const of = (id: string) => {
  const a = answers[id]!
  return { a, used: a.sources.map((s) => facts.find((f) => f.id === s)!) }
}

describe('Copy for Slack', () => {
  it('keeps the state line second, and each source with who checked it and when', () => {
    const { a, used } = of('grounded')
    const lines = slackText(a, used).split('\n')
    expect(lines[0]).toBe(`*${a.question}*`)
    expect(lines[1]).toBe(`Checked (${used.length} ${used.length === 1 ? 'item' : 'items'})`)
    for (const [i, f] of used.entries())
      expect(lines).toContain(`${i + 1} ${f.title} - ${f.checkedBy}, checked ${f.checkedOn}`)
  })
  it('says Not found with its sentence, and no sources line, when nothing is written down', () => {
    const { a, used } = of('missing')
    const text = slackText(a, used)
    expect(text.split('\n')[1]).toBe('Not found. Nothing is written about this yet.')
    expect(text).not.toMatch(/^1 /m)
  })
  it('carries the short sentence for every state but Checked', () => {
    expect(stateLineOf({ state: 'partial' }, 1)).toBe(
      'Partial (1 item). Only part of this is written down.',
    )
    expect(stateLineOf({ state: 'conflict' }, 2)).toBe(
      'Conflict (2 items). Two items say different things.',
    )
  })
  it('never gives a question that was not looked up a state', () => {
    expect(stateLineOf({ state: null }, 0)).toBe('Nothing was looked up.')
  })
  it("dates the card from the demo world's today, with the workspace's name and no product name in a sentence", () => {
    expect(answeredOn('2026-10-23')).toBe('23 Oct 2026')
    expect(cardFooter('Larchwood Outdoor', '2026-10-23')).toBe(
      'Larchwood Outdoor - answered 23 Oct 2026',
    )
    // A workspace nobody named yet: when, and nothing before it.
    expect(cardFooter('', '2026-10-23')).toBe('Answered 23 Oct 2026')
  })
})
