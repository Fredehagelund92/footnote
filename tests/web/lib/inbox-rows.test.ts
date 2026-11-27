import { describe, expect, it } from 'vitest'
import { cards } from '@/api/mock/data/inbox'
import type { Inbox } from '@/api'
import { dueScope, groupOf, inboxRows, INBOX_GROUPS, startsFolded } from '@/lib/inbox-rows'

// The Inbox's order of need: what people wait on first (a mention of you, a suggestion), the
// chores after, and a long run of checks folded until it is wanted.

const jon = { name: 'Jon Abara' }
const inbox = (extra: Partial<Inbox> = {}): Inbox => ({
  cards: cards.map((c) => ({ ...c, for: jon.name })),
  waiting: [],
  sent: [],
  done: {},
  opened: {},
  reviewed: {},
  week: { asked: 0, askedAtLeast: 0, askedToday: false, found: 0, nothing: 0, mostAbout: null },
  mentions: [],
  ...extra,
})

describe('the order of the groups', () => {
  it('puts Mentioned you and Suggestions before every chore', () => {
    const ids = INBOX_GROUPS.map((g) => g.id)
    expect(ids.slice(0, 3)).toEqual(['names', 'mention', 'suggestion'])
  })

  it('names the group of unanswered topics Nothing written yet, never a lone Not found', () => {
    expect(INBOX_GROUPS.find((g) => g.id === 'gap')?.label).toBe('Nothing written yet')
  })

  it('lists a suggestion before a Nothing written yet card, whatever order the read gave', () => {
    const { rows } = inboxRows(inbox(), jon.name, {})
    const groups = rows.map(groupOf)
    const firstChore = groups.findIndex((g) => g !== 'mention' && g !== 'suggestion')
    expect(groups.indexOf('suggestion')).toBe(0)
    expect(groups.lastIndexOf('suggestion')).toBeLessThan(firstChore)
  })
})

describe('the groups that start folded', () => {
  it('folds Due for a check above 10 and no other group', () => {
    expect(startsFolded('check', 11)).toBe(true)
    expect(startsFolded('check', 10)).toBe(false)
    expect(startsFolded('suggestion', 200)).toBe(false)
    expect(startsFolded('gap', 200)).toBe(false)
  })
})

describe('dueScope', () => {
  it('names every domain for an admin and the owned ones for an owner', () => {
    expect(dueScope({ admin: true })).toBe('in all domains')
    expect(dueScope({ admin: false })).toBe('in your domains')
  })
})

describe('a suggestion an owner closed', () => {
  const closedRow = {
    id: 'p-closed',
    for: jon.name,
    title: 'Retention window',
    waitingFor: 'Mira Voss, owner of Support',
    domain: 'support',
    sent: 'Today',
    card: 'p-closed',
    closed: { by: 'Mira Voss', when: 'Today', reason: 'Out of date.' },
  }
  const withClosed = (opened: Record<string, boolean>) =>
    inboxRows(inbox({ cards: [], waiting: [closedRow], opened }), jon.name, {})

  it('needs the sender until they open it, and not after', () => {
    expect(withClosed({}).needing).toHaveLength(1)
    expect(withClosed({ 'p-closed': true }).needing).toHaveLength(0)
  })

  it('stays a row under All but is not one waiting on others', () => {
    const rows = withClosed({ 'p-closed': true })
    expect(rows.rows).toHaveLength(1)
    expect(rows.waiting).toHaveLength(0)
  })

  it('counts a suggestion still waiting on an owner', () => {
    const { closed: _closed, ...open } = closedRow
    const rows = inboxRows(inbox({ cards: [], waiting: [open] }), jon.name, {})
    expect(rows.waiting).toHaveLength(1)
  })
})
