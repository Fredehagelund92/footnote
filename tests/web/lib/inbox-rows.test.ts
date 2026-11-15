import { describe, expect, it } from 'vitest'
import { cards } from '@/api/mock/data/inbox'
import type { Inbox } from '@/api'
import { groupOf, inboxRows, INBOX_GROUPS, startsFolded } from '@/lib/inbox-rows'

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
  week: { asked: 0, found: 0, nothing: 0, mostAbout: null },
  mentions: [],
  ...extra,
})

describe('the order of the groups', () => {
  it('puts Mentioned you and Suggestions before every chore', () => {
    const ids = INBOX_GROUPS.map((g) => g.id)
    expect(ids.slice(0, 3)).toEqual(['names', 'mention', 'suggestion'])
  })

  it('lists a suggestion before a Not found card, whatever order the read gave', () => {
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
