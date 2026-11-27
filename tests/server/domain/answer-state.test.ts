import { describe, expect, it } from 'vitest'
import {
  ANSWER_LINES,
  answerStateOf,
  answerStates,
  replyStatus as replyStatusOf,
  replyStatuses,
  resolverStatusOf,
  stateOfStatus,
  stateWords,
} from '../../../src/domain/answer-state.ts'
import { statusRules, statusRuleWords } from '../../../src/domain/mcp-text.ts'

/*
  The six answer states (FR-349), as docs/product.md section 6 and
  ANSWER_LINES give them: one list, the same words for agents and people.
*/
describe('the answer lines', () => {
  it('are the six states, with the labels and sentences of the product page', () => {
    expect(ANSWER_LINES.map((line) => line.state)).toEqual([...answerStates])
    expect(
      Object.fromEntries(ANSWER_LINES.map((line) => [line.state, [line.label, line.sentence]])),
    ).toEqual({
      grounded: ['Checked', 'This is written down and checked.'],
      partial: ['Partial', 'Only part of this is written down.'],
      missing: ['Not found', 'Nothing published about this yet.'],
      conflict: ['Conflict', 'Two items say different things.'],
      stale: ['Outdated', 'Some of this may be old.'],
      failed: ['Not looked up', 'Ask could not look this up just now.'],
    })
    // One to three plain words, and something to do for each.
    for (const line of ANSWER_LINES) {
      expect(line.label.split(' ').length, line.state).toBeLessThanOrEqual(3)
      expect(line.todo.length, line.state).toBeGreaterThan(0)
    }
  })

  it('map one to one to the statuses an agent reads, with need_more_detail as no state', () => {
    expect(new Set(ANSWER_LINES.map((line) => line.status)).size).toBe(6)
    for (const line of ANSWER_LINES) expect(stateOfStatus(line.status)).toBe(line.state)
    expect(stateOfStatus('need_more_detail')).toBeNull()
    expect([...ANSWER_LINES.map((line) => line.status), 'need_more_detail'].sort()).toEqual(
      [...replyStatuses].sort(),
    )
  })

  it('are said first, the label and, but for Checked, its sentence', () => {
    expect(stateWords('grounded')).toBe('Checked.')
    expect(stateWords('missing')).toBe('Not found. Nothing published about this yet.')
  })

  it('are taught to agents by status and label, in the one text the skill file repeats', () => {
    expect(statusRules.map((rule) => rule.status)).toEqual([
      ...ANSWER_LINES.map((line) => line.status),
      'need_more_detail',
    ])
    expect(statusRuleWords(statusRules[0]!)).toBe(
      'matched (Checked): use the items and keep each not_to_conclude.',
    )
    expect(statusRuleWords(statusRules.at(-1)!)).toMatch(/^need_more_detail: /)
  })
})

const none = { metrics: [], values: [] }
const replyStatus = (
  input: Partial<Parameters<typeof replyStatusOf>[0]> &
    Pick<Parameters<typeof replyStatusOf>[0], 'status'>,
) => replyStatusOf({ items: [], uncovered: none, assumed: false, withheld: 0, ...input })

describe('a reply status', () => {
  const exact = { match: 'exact' as const, unverified: false, unreviewed: false }
  const part = { match: 'partial' as const, unverified: false, unreviewed: false }
  const old = { match: 'exact' as const, unverified: true, unreviewed: false }
  const unread = { ...exact, unreviewed: true }

  it('keeps what the resolver found when it found no match', () => {
    for (const status of ['no_match', 'conflict', 'need_more_detail', 'check_failed'] as const)
      expect(
        replyStatusOf({ status, items: [old], uncovered: none, assumed: false, withheld: 0 }),
      ).toBe(status)
  })

  it('is Partial when part of the question has nothing written for it', () => {
    expect(replyStatus({ status: 'matched', items: [part, part] })).toBe('partial')
    expect(
      replyStatus({
        status: 'matched',
        items: [exact],
        uncovered: { metrics: [], values: ['val:market/spain'] },
      }),
    ).toBe('partial')
    // An item that covers part of it beside one that covers all of it is Checked.
    expect(replyStatus({ status: 'matched', items: [exact, part] })).toBe('matched')
  })

  it('is Partial when the dates were assumed, ahead of Outdated and Checked', () => {
    expect(replyStatus({ status: 'matched', items: [exact], assumed: true })).toBe('partial')
    expect(replyStatus({ status: 'matched', items: [old], assumed: true })).toBe('partial')
    expect(replyStatus({ status: 'conflict', items: [exact], assumed: true })).toBe('conflict')
    expect(replyStatus({ status: 'no_match', items: [], assumed: true })).toBe('no_match')
  })

  it('is Partial when every item was published without review, never Checked', () => {
    expect(replyStatus({ status: 'matched', items: [unread] })).toBe('partial')
    expect(
      replyStatus({ status: 'matched', items: [unread, { ...unread, unverified: true }] }),
    ).toBe('partial')
    // One checked item beside it carries the answer.
    expect(replyStatus({ status: 'matched', items: [exact, unread] })).toBe('matched')
    expect(replyStatus({ status: 'conflict', items: [unread, unread] })).toBe('conflict')
  })

  it('is Partial when a match is held back, never Checked (agent-side review, call 4)', () => {
    expect(replyStatus({ status: 'matched', items: [exact], withheld: 1 })).toBe('partial')
    expect(replyStatus({ status: 'matched', items: [old], withheld: 1 })).toBe('partial')
    expect(replyStatus({ status: 'conflict', items: [exact], withheld: 1 })).toBe('conflict')
    // With nothing given it is Not found, as before: the reply says what is held back.
    expect(replyStatus({ status: 'no_match', items: [], withheld: 1 })).toBe('no_match')
  })

  it('is Outdated when an item may be out of date, after Partial', () => {
    expect(replyStatus({ status: 'matched', items: [exact, old] })).toBe('stale')
    expect(replyStatus({ status: 'matched', items: [part, { ...part, unverified: true }] })).toBe(
      'partial',
    )
    expect(replyStatus({ status: 'matched', items: [exact] })).toBe('matched')
  })

  it('reads back as what the resolver found, for a test question and the request log', () => {
    expect(resolverStatusOf('partial')).toBe('matched')
    expect(resolverStatusOf('stale')).toBe('matched')
    expect(resolverStatusOf('no_match')).toBe('no_match')
  })
})

describe('the answer state', () => {
  const item = (over = {}) => ({
    match: 'exact' as const,
    unverified: false,
    unreviewed: false,
    ...over,
  })
  const metric = { metrics: ['metric:revenue'], values: [] }
  const value = { metrics: [], values: ['val:market/spain'] }
  it.each([
    ['check_failed', [item()], none, false, 'failed'],
    ['need_more_detail', [], none, false, 'missing'],
    ['no_match', [], none, false, 'missing'],
    ['matched', [], none, false, 'missing'],
    ['conflict', [item({ unverified: true })], metric, true, 'conflict'],
    ['matched', [item()], metric, false, 'partial'],
    ['matched', [item({ unverified: true })], value, false, 'partial'],
    ['matched', [item()], none, true, 'partial'],
    ['matched', [item({ match: 'partial' })], none, false, 'partial'],
    ['matched', [item({ unreviewed: true })], none, false, 'partial'],
    ['matched', [item(), item({ unverified: true })], none, false, 'stale'],
    ['matched', [item()], none, false, 'grounded'],
  ] as const)('%s with %j, %j, assumed %s, is %s', (status, items, uncovered, assumed, state) => {
    expect(answerStateOf({ status, items, uncovered, assumed, withheld: 0 })).toBe(state)
    // The reply status is the same state in the status's words (a lookup in ANSWER_LINES).
    if (!items.length && status === 'matched') return
    const reply = replyStatusOf({ status, items, uncovered, assumed, withheld: 0 })
    expect(stateOfStatus(reply) ?? 'missing').toBe(state)
  })
})
