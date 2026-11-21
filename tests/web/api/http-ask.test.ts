import { describe, expect, it } from 'vitest'
import type { Asked, LoopTurn } from '@contract/answer'
import type { Answer } from '@/model/ask'
import { lookupFailedNote } from '@domain/words'
import {
  askedWeekOf,
  createChatShelf,
  KEPT_ANSWERS,
  dayOf,
  examplesOf,
  failedAnswer,
  loopAnswerOf,
  namesOf,
  type Shelf,
} from '@/api/http-ask'

const vocabulary = {
  families: [],
  metrics: [{ id: 'orders', name: 'Orders', group: 'Payments' }],
  dimensions: [
    {
      id: 'market',
      name: 'Market',
      values: [
        { id: 'norway', name: 'Norway', aliases: [] },
        { id: 'spain', name: 'Spain', aliases: [] },
      ],
    },
  ],
}
const names = namesOf(vocabulary)

const norway = {
  metrics: ['metric:orders'],
  filters: { 'dim:market': ['val:market/norway'] },
  window: { start: '2026-08-01', end: '2026-09-01' },
}

describe("Ask's answer when the service gave none", () => {
  it('gives Not checked no words, and says the check could not run', () => {
    const failed = failedAnswer('Orders?')
    expect(failed).toMatchObject({ state: 'failed', text: '', note: lookupFailedNote })
    expect(failed.note).toMatch(/^Ask could not look this up just now\. .*Ask again in a minute\.$/)
  })
})

const asked: Asked = {
  week: '2026-10-19',
  rows: [
    {
      title: 'Orders in Norway',
      area: 'area_sales',
      scope: { ...norway, window: { start: '2026-10-01', end: '2026-11-01' } },
      months: ['2026-10-01'],
      count: null,
      atLeast: 24,
      nothing: 0,
      state: 'grounded',
      items: 2,
      gap: null,
    },
    {
      title: 'Orders in Spain',
      area: 'area_sales',
      scope: {
        ...norway,
        filters: { 'dim:market': ['val:market/spain'] },
        window: { start: '2026-10-01', end: '2026-11-01' },
      },
      months: ['2026-10-01'],
      count: 12,
      atLeast: 12,
      nothing: 12,
      state: 'missing',
      items: 0,
      gap: { card: 'gap:7c0a', draft: '01a17d14-ec57' },
    },
  ],
  hidden: null,
  asked: 142,
  askedAtLeast: 136,
  starters: [{ title: 'Orders in Norway', scope: norway }],
}

describe('Asked this week from the service', () => {
  it('asks each row as a question, shows a total that would give a month away as at least, and leads an owner to the draft', () => {
    const week = askedWeekOf(asked, names)
    expect(week).toMatchObject({ asked: 142, hidden: 0 })
    expect(week.rows[0]).toMatchObject({
      title: 'Orders in Norway',
      question: 'What should I know about Orders in Norway?',
      count: '24+',
      times: 24,
      state: 'grounded',
      sources: 2,
      topic: { metric: 'Orders', where: 'Norway', domain: 'area_sales', month: '2026-10' },
    })
    expect(week.rows[0]!.next).toBeUndefined()
    expect(week.rows[1]!.next).toEqual({
      label: 'Write it',
      href: '/context/new?gap=01a17d14-ec57',
    })
    expect(
      askedWeekOf(
        { ...asked, rows: [{ ...asked.rows[1]!, gap: { card: 'gap:7c0a', draft: null } }] },
        names,
      ).rows[0]!.next,
    ).toEqual({ label: 'Open the card', href: '/inbox?card=gap%3A7c0a' })
  })

  it('is empty while nothing is shared with agents', () => {
    expect(askedWeekOf(null, names)).toEqual({ rows: [], hidden: 0, asked: 0 })
    expect(examplesOf(null)).toEqual([])
  })

  it('offers the rows and then the starters as questions', () => {
    const examples = examplesOf(asked)
    expect(examples.map((e) => [e.question, e.starter ?? false])).toEqual([
      ['What should I know about Orders in Norway?', false],
      ['What should I know about Orders in Spain?', false],
      ['What should I know about Orders in Norway?', true],
    ])
  })
})

describe("the person's chats in the browser", () => {
  const memory = (): Shelf & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
      data,
      get: (k) => data.get(k) ?? null,
      set: (k, v) => void data.set(k, v),
      remove: (k) => void data.delete(k),
    }
  }

  it('keeps each person their own chats, newest first, and puts a deleted one back once', () => {
    let now = Date.parse('2026-10-23T09:00:00')
    const shelf = memory()
    const chats = createChatShelf(shelf, () => now)
    chats.add('per_jon', 'c1', 'First?', 'It says one thing.')
    now += 60_000
    chats.add('per_jon', 'c2', 'Second?', '')
    chats.add('per_ines', 'c3', 'Hers?', '')
    expect(chats.list('per_jon').map((t) => t.id)).toEqual(['c2', 'c1'])
    expect(chats.list('per_ines').map((t) => t.id)).toEqual(['c3'])
    chats.rename('per_jon', 'c1', 'Renamed')
    const { undo } = chats.remove('per_jon', 'c1')
    expect(chats.list('per_jon').map((t) => t.id)).toEqual(['c2'])
    expect(chats.undo(undo.token)).toBe(true)
    expect(chats.undo(undo.token)).toBe(false)
    expect(chats.list('per_jon').find((t) => t.id === 'c1')).toMatchObject({
      title: 'Renamed',
      preview: 'It says one thing.',
      day: 'Today',
      time: '09:00',
    })
    expect(chats.undo('a-decision-token')).toBe(false)
  })

  it("keeps a chat's finished loop answers with it, for the newest chats only", () => {
    let now = Date.parse('2026-10-23T09:00:00')
    const shelf = memory()
    const chats = createChatShelf(shelf, () => now)
    const answer = (question: string): Answer => ({
      id: 'a',
      question,
      metric: '',
      markets: [],
      state: null,
      text: 'Said.',
      sources: [],
      said: '',
    })
    chats.add('per_jon', 'c1', 'First?', '')
    chats.keep('per_jon', 'c1', 'First?', [answer('First?'), answer('And then?')])
    // Opened again, the chat has its answers: nothing need be asked again.
    expect(chats.list('per_jon')[0]?.answers?.map((a) => a.question)).toEqual([
      'First?',
      'And then?',
    ])
    for (let i = 2; i <= KEPT_ANSWERS + 1; i++) {
      now += 60_000
      chats.keep('per_jon', `c${i}`, `Q${i}?`, [answer(`Q${i}?`)])
    }
    const kept = chats.list('per_jon')
    expect(kept).toHaveLength(KEPT_ANSWERS + 1)
    // The oldest gives its answers up, and asks again when it is opened.
    expect(kept.at(-1)).toMatchObject({ id: 'c1' })
    expect(kept.at(-1)?.answers).toBeUndefined()
    expect(kept.filter((t) => t.answers?.length)).toHaveLength(KEPT_ANSWERS)
  })

  it("forgets one person's chats at sign-out, so a deleted one cannot come back either", () => {
    const shelf = memory()
    const chats = createChatShelf(shelf)
    chats.add('per_jon', 'c1', 'First?', '')
    chats.add('per_jon', 'c2', 'Second?', '')
    chats.add('per_ines', 'c3', 'Hers?', '')
    const { undo } = chats.remove('per_jon', 'c2')
    chats.forget('per_jon')
    expect([...shelf.data.keys()]).toEqual(['footnote.ask.chats.per_ines'])
    expect(chats.list('per_jon')).toEqual([])
    expect(chats.undo(undo.token)).toBe(false)
    expect(chats.list('per_jon')).toEqual([])
    expect(chats.list('per_ines').map((t) => t.id)).toEqual(['c3'])
  })

  it('reads a shelf it cannot parse as no chats', () => {
    const shelf = memory()
    shelf.set('footnote.ask.chats.per_jon', '{not json')
    expect(createChatShelf(shelf).list('per_jon')).toEqual([])
  })

  it('groups chats by day: today and yesterday by the clock, earlier by date', () => {
    const now = Date.parse('2026-10-23T09:00:00')
    expect(dayOf(Date.parse('2026-10-23T08:05:00'), now)).toEqual({ day: 'Today', time: '08:05' })
    expect(dayOf(Date.parse('2026-10-22T16:30:00'), now)).toEqual({
      day: 'Yesterday',
      time: '16:30',
    })
    expect(dayOf(Date.parse('2026-10-19T11:00:00'), now)).toEqual({
      day: 'Earlier',
      time: '19 Oct',
    })
  })
})

describe("the subject of a loop turn's answer", () => {
  const nouns = [
    { id: 'metric:tickets', name: 'Tickets closed', of: null, type: null },
    {
      id: 'value:team/billing',
      name: 'Billing',
      of: { id: 'dimension:team', name: 'Team' },
      type: null,
    },
  ]
  const turn = (
    subject: Omit<NonNullable<LoopTurn['subject']>, 'carried' | 'uncovered'> | null,
  ): LoopTurn => ({
    kind: 'answer',
    text: '',
    sources: [],
    state: 'missing',
    footer: { denominator: null, notSeen: null, stale: null },
    read: [],
    subject: subject && { ...subject, carried: false, uncovered: [] },
    nearby: [],
    conflict: [],
    definitions: [],
    choices: [],
    reads: [],
    stopped: null,
    body: [],
    said: '',
    nouns,
    items: [],
    closest: null,
    owners: [],
    overview: null,
    checks: [],
  })

  it('names the metric, the values of any dimension and the days the subject was read for', () => {
    const a = loopAnswerOf(
      turn({
        names: ['Tickets closed', 'Billing'],
        about: ['metric:tickets', 'value:team/billing'],
        period: '1-31 Aug 2026',
        note: null,
        assumedToday: false,
      }),
      'Tickets closed by billing?',
      names,
    )
    expect(a.metric).toBe('Tickets closed')
    expect(a.markets).toEqual(['Billing'])
    expect(a.dates).toBe('1 to 31 Aug 2026')
    // The page draws the turn itself.
    expect(a.loop?.nouns).toEqual(nouns)
  })

  it('gives no days when the read assumed today, and no subject when there was none', () => {
    const today = loopAnswerOf(
      turn({
        names: ['Tickets closed'],
        about: ['metric:tickets'],
        period: '8 Nov 2026',
        note: null,
        assumedToday: true,
      }),
      'Tickets?',
      names,
    )
    expect(today.metric).toBe('Tickets closed')
    expect(today.dates).toBeUndefined()
    const none = loopAnswerOf(turn(null), 'Hi', names)
    expect(none.metric).toBe('')
    expect(none.markets).toEqual([])
  })
})

describe('a family in the names of a question', () => {
  const withFamily = namesOf({
    ...vocabulary,
    families: [{ key: 'group:revenue', name: 'Revenue', variants: 250 }],
  })

  it('is named by its own name, never the raw key', () => {
    expect(withFamily.metric('group:revenue')).toBe('Revenue')
    expect(withFamily.metricKey('revenue')).toBe('group:revenue')
    expect(withFamily.terms?.map((t) => [t.key, t.name])).toContainEqual(['group:revenue', 'Revenue'])
  })
})
