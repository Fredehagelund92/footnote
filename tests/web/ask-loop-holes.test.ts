import { describe, expect, it } from 'vitest'
import { turnOf, type MadeRead } from '../../src/server/modules/answer/index.ts'
import { holesIn } from './ask-eval/graders.ts'

/*
  The six replies of the release judgement (17 November 2026, Ask's loop on Sonnet 5.5 on the demo)
  whose sentences code left with a hole: P5, C4, V5, R2, T4 and T7. Each is the model's words as the
  recorded turn and its checks give them, on the parts of the reads they cite, through the code
  that writes the answer (FR-720). Each now reads whole, and the check that fails a reply with a
  hole in a sentence (the eval's promise "whole") finds none in it.
*/

const names = [
  { id: 'metric:orders', name: 'Orders', of: null, type: null },
  { id: 'value:market/sweden', name: 'Sweden', of: 'Market', type: 'string' },
  { id: 'value:market/norway', name: 'Norway', of: 'Market', type: 'string' },
  { id: 'value:market/poland', name: 'Poland', of: 'Market', type: 'string' },
  { id: 'value:market/united_kingdom', name: 'United Kingdom', of: 'Market', type: 'string' },
  { id: 'value:product/footwear', name: 'Footwear', of: 'Product', type: 'string' },
  { id: 'domain:area_sales', name: 'Sales', of: null, type: null },
]
const item = (id: string, title: string) => ({
  id,
  title,
  summary: `${title}.`,
  kind: 'rule',
  domain: 'Sales',
  domainId: 'domain:area_sales',
  about: ['metric:orders'],
  checked: { role: 'the owner of Sales', date: '2026-11-17' },
  outOfDate: null,
})
const outOf = (count: number, of = 'published context items you may read') => ({ count, of })
/** A look-up as get_context gives it: what applies, how it read the words, what it is out of. */
const lookup = (
  ref: string,
  about: string,
  items: object[],
  of: number,
  days: { from: string; to: string } | null = null,
): MadeRead => ({
  tool: 'get_context',
  ref,
  input: { about },
  result: {
    state: items.length ? 'grounded' : 'missing',
    read: {
      words: about,
      names: [],
      about: [],
      period: days ? `${days.from} to ${days.to}` : 'any date',
      assumedToday: false,
      datesRead: null,
      days,
      otherDays: null,
    },
    items,
    nearby: [],
    notCovered: [],
    uncovered: [],
    more: 0,
    wider: null,
    owners: [],
    searched: [],
    widened: 'not needed',
    outOf: outOf(of),
    unread: null,
    nothing: null,
    names,
    ids: items.map((i) => (i as { id: string }).id),
  },
})
const records = (ref: string, count: number, of: number, words: string): MadeRead => ({
  tool: 'records',
  ref,
  input: {},
  result: {
    count,
    outOf: outOf(of, words),
    counted: `${count} of ${of.toLocaleString('en-GB')} ${words}`,
    names,
    ids: [],
  },
})

/** Each reply: the model's words, what it read, and the words the judgement read. */
const replies: {
  id: string
  question: string
  words: string
  made: MadeRead[]
  broken: string[]
  whole: string[]
}[] = [
  {
    id: 'P5',
    question: 'What changed for orders in Sweden since January?',
    words: [
      'Two written items cover changes for [@metric:orders] in [@value:market/sweden] from [#r1.days.from] to [#r1.days.to]:',
      '',
      '- A new VAT rate started in Sweden on 10 December 2025. [itm_mtzqvz5l]',
      '- Sweden orders before 19 January 2026 come from the old payment report. It is written for [@value:product/footwear], and its check date has passed. [itm_r6lyl1pc]',
      '',
      'These are the items for this subject that were changed in that period [#r2.count].',
    ].join('\n'),
    made: [
      lookup(
        'r1',
        'orders in Sweden',
        [item('itm_mtzqvz5l', 'Sweden VAT change'), item('itm_r6lyl1pc', 'Sweden payment report')],
        1292,
        { from: '2026-01-01', to: '2026-11-17' },
      ),
      records('r2', 2, 1292, 'context items you may read'),
    ],
    broken: [
      'Two written items cover changes for Orders in Sweden from to:',
      'changed in that period 2.',
    ],
    whole: [
      'Two written items cover changes for Orders in Sweden from 1 January 2026 to 17 November 2026:',
      'These are the items for this subject that were changed in that period.',
    ],
  },
  {
    id: 'C4',
    question: 'What is our NPS in Norway?',
    words:
      'Nothing written covers NPS in [@value:market/norway]: Footnote has no definition for NPS, and none of the [#r1.outOf] published items you may read mention it.',
    made: [lookup('r1', 'NPS in Norway', [], 1209)],
    broken: [
      'none of the 1,209 published context items you may read published items you may read mention it.',
    ],
    whole: ['none of the 1,209 published context items you may read mention it.'],
  },
  {
    id: 'V5',
    question: 'anything new?',
    words:
      'Yes, [#r1.count] of [#r1.outOf] context items you may read changed in the last week (10 to 17 November 2026), all published today.',
    made: [records('r1', 3, 1292, 'context items you may read')],
    broken: ['Yes, 3 of 1,292 context items you may read you may read changed in the last week'],
    whole: ['Yes, 3 of 1,292 context items you may read changed in the last week'],
  },
  {
    id: 'R2',
    question: 'Which context items disagree with each other right now?',
    words:
      'One pair of items is marked as disagreeing. Both are in [@domain:domain_area_sales] and apply to [@metric:orders] in [@value:market/united_kingdom], from 1 January 2026 on.',
    made: [
      {
        tool: 'conflicts',
        ref: 'r1',
        input: {},
        result: { count: 1, pairs: [], names, ids: [] },
      },
    ],
    broken: ['Both are in Domain area sales and apply to'],
    whole: ['Both are in Sales and apply to Orders in United Kingdom'],
  },
  {
    id: 'T4',
    question: 'How many times did agents ask about orders in Norway this week?',
    words:
      'Agents asked about [@metric:orders] in [@value:market/norway] [#r1.topics.0.calls] times in [#r1.week], and none of those calls found no context ([#r1.topics.0.foundNothing]).',
    made: [
      {
        tool: 'agent_questions',
        ref: 'r1',
        input: { about: ['orders', 'Norway'] },
        result: {
          week: 'the week of 10-16 Nov 2026',
          minimum: 3,
          topics: [
            {
              title: 'Orders in Norway',
              domain: 'Sales',
              calls: '36',
              exact: 36,
              atLeast: 36,
              foundNothing: '0',
              about: ['metric:orders', 'value:market/norway'],
            },
          ],
          more: 0,
          total: null,
          names,
          ids: ['Orders in Norway'],
        },
      },
    ],
    broken: ['none of those calls found no context (0).'],
    whole: ['none of those calls found no context.'],
  },
  {
    id: 'T7',
    question: 'What is written about orders in Poland?',
    words:
      '[@metric:orders] in [@value:market/poland] has [#r1.count] items written that apply, out of [#r1.outOf] published items you may read. Two are warnings about late data.',
    made: [
      lookup(
        'r1',
        'orders in Poland',
        [item('itm_50d28ff4b4', 'Poland files late'), item('itm_k4p3nj1b', 'Poland late days')],
        1210,
      ),
    ],
    broken: [
      'has items written that apply, out of 1,210 published context items you may read published items you may read.',
    ],
    whole: [
      'Orders in Poland has 2 items written that apply, out of 1,210 published context items you may read.',
    ],
  },
]

describe('the six replies with a hole in a sentence (release judgement, A2)', () => {
  for (const r of replies)
    it(`${r.id} reads whole`, () => {
      const turn = turnOf(r.words, r.made, [], r.question)
      for (const words of r.whole) expect(turn.text).toContain(words)
      for (const words of r.broken) expect(turn.text).not.toContain(words)
      expect(holesIn(turn.text)).toEqual([])
    })

  it('keeps a count after a word that leads into it, though an earlier sentence has the same number', () => {
    const made = [
      records('r1', 3, 1292, 'context items you may read'),
      records('r2', 3, 1292, 'context items you may read'),
    ]
    const text = turnOf('Sweden has [#r1.count] items. Norway has [#r2.count].', made, []).text
    expect(text).toBe('Sweden has 3 items. Norway has 3.')
    expect(holesIn(text)).toEqual([])
  })

  it("leaves out a read's words its clause says already (the eval's F18)", () => {
    const made: MadeRead = {
      tool: 'agent_questions',
      ref: 'r1',
      input: { about: ['orders', 'Poland'], found_nothing: true },
      result: {
        week: 'the week of 16-22 Oct 2026',
        topics: [{ title: 'Orders in Poland', calls: '13', foundNothing: 'fewer than 5' }],
        names,
        ids: ['Orders in Poland'],
      },
    }
    const text = turnOf(
      'The topic "Orders in Poland" was asked 13 times in the week of 16-22 October 2026 [#r1.names.0.name], but the read does not give how many of those calls found nothing: it only shows that fewer than 5 did [#r1.topics.0.foundNothing].',
      [made],
      [],
    ).text
    expect(text).toBe(
      'The topic "Orders in Poland" was asked 13 times in the week of 16-22 October 2026, but the read does not give how many of those calls found nothing: it only shows that fewer than 5 did.',
    )
    expect(holesIn(text)).toEqual([])
  })

  // R2 named a domain by a raw id, and T4 said its zero twice: words, not a hole in a sentence.
  it('the check finds the hole in each sentence that had one as the judgement read it', () => {
    for (const r of replies.filter((x) => !['R2', 'T4'].includes(x.id)))
      expect(holesIn(r.broken[0]!), r.id).not.toEqual([])
  })
})
