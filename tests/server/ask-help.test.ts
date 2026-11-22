import { describe, expect, it } from 'vitest'
import {
  readHelp,
  searchHelp,
  turnOf,
  type MadeRead,
} from '../../src/server/modules/answer/index.ts'

/*
  Ask on a question about Footnote itself (FR-719.8): the help read finds the built-in help's
  parts (docs/help) as the docs' own search does, and an answer from them carries the pages as its
  source and no state, so it never reads as Not found.
*/

describe('the help Ask reads', () => {
  it('is every page of the built-in help, cut at its headings', () => {
    const sections = readHelp()
    expect(new Set(sections.map((s) => s.slug)).size).toBeGreaterThan(15)
    expect(sections.some((s) => s.slug === 'answer-lines' && s.id === 'the-six-lines')).toBe(true)
    expect(sections.some((s) => s.slug === 'write-context')).toBe(true)
    expect(sections.every((s) => s.text.length > 0 || s.heading.length > 0)).toBe(true)
  })

  it('finds the part that answers a question about the product, best first', () => {
    expect(searchHelp('Checked answer line')[0]).toMatchObject({ slug: 'answer-lines' })
    expect(searchHelp('add a context item')[0]).toMatchObject({ slug: 'write-context' })
    expect(searchHelp('')).toEqual([])
  })
})

describe('an answer from the help', () => {
  const helpRead = (words: string): MadeRead => ({
    tool: 'help',
    input: { words },
    ref: 'r1',
    result: {
      words,
      found: 1,
      pages: searchHelp(words).map((s) => ({
        page: s.id ? `${s.slug}#${s.id}` : s.slug,
        title: s.title,
        heading: s.heading,
        text: s.text,
        ...(s.does ? { does: s.does } : {}),
      })),
      ids: [],
    },
  })
  const searchedNothing: MadeRead = {
    tool: 'find_context',
    input: { words: 'checked' },
    ref: 'r2',
    result: {
      items: [],
      searched: [
        {
          words: 'checked',
          names: [],
          about: [],
          period: 'any date',
          kinds: [],
          domain: null,
          without: null,
          found: 0,
        },
      ],
      outOf: { count: 1410, of: 'published context items you can see' },
      more: 0,
      names: [],
      ids: [],
    },
  }

  it('carries the help page as its source and no state, even after a search found nothing', () => {
    const t = turnOf(
      'Checked means the answer rests on context its owner published with a source and a check date. Nothing is left to do.',
      [helpRead('Checked answer line'), searchedNothing],
      [],
      'What does Checked mean on an answer?',
    )
    expect(t.state).toBeNull()
    expect(t.help).toEqual([
      {
        slug: 'answer-lines',
        id: 'the-six-lines',
        title: 'Answer lines',
        heading: 'The six lines',
      },
    ])
    expect(t.nearby).toEqual([])
    expect(t.closest).toBeNull()
    expect(t.read).toEqual([
      'Read the help for “Checked answer line”: 1 part.',
      expect.stringMatching(/^Searched “checked”/),
    ])
  })

  it('finds the steps for a screen by the words people use for it, with the action they explain', () => {
    expect(searchHelp('connect a source like dbt')[0]).toMatchObject({
      slug: 'integrations',
      id: 'connect-a-source',
      does: ['connect_source'],
    })
    expect(searchHelp('create my first context item')[0]).toMatchObject({
      slug: 'write-context',
      id: 'add-a-context-item',
      does: ['write_context'],
    })
    expect(searchHelp('invite a colleague')[0]).toMatchObject({
      slug: 'domains-and-owners',
      id: 'people',
      does: ['invite_people'],
    })
  })

  it('shows as its source the help part its steps came from, by the words a model searched', () => {
    // Each question with the words Sonnet searched the help for, and the steps it wrote (live).
    const howTo = [
      {
        question: 'How do I create a context item about a metric?',
        words: 'add a context item about a metric',
        text: 'To create a context item, open Context and choose New context. The editor opens on a new item with its first question: What should agents know?',
        part: 'write-context#add-a-context-item',
      },
      {
        question: 'How do I approve a suggestion?',
        words: 'approve a suggestion',
        text: 'A suggestion waits in its owner’s Inbox, and you decide on it in the review: you publish it, return it or close it.',
        part: 'review-a-suggestion#',
      },
      {
        question: 'How do I mark a context item as checked?',
        words: 'mark a context item as checked',
        text: 'Choose Still true on its card when it is due for a check: it then counts as checked today, by you, and its next check date moves on.',
        part: 'keep-context-up-to-date#due-for-a-check',
      },
    ]
    for (const { question, words, text, part } of howTo) {
      const t = turnOf(text, [helpRead(words)], [], question)
      expect(
        t.help?.map((h) => `${h.slug}#${h.id}`),
        question,
      ).toEqual([part])
    }
  })

  it('is no help answer when it cites an item: the context it rests on is its source', () => {
    const t = turnOf('Nothing written covers it.', [searchedNothing], [], 'Why?')
    expect(t.help).toBeUndefined()
    expect(t.state).toBe('missing')
  })
})

/*
  Quick actions (FR-719.10): the words mark what they explain how to do, and code keeps a mark only
  when a read of the chat offered that action, at most two, with the family a definitions read
  found. Who may do it is the page's, by the same list.
*/
describe('the quick actions an answer offers', () => {
  const helpRead = (words: string, ref = 'r1'): MadeRead => ({
    tool: 'help',
    input: { words },
    ref,
    result: {
      words,
      found: 1,
      pages: searchHelp(words).map((s) => ({
        page: s.id ? `${s.slug}#${s.id}` : s.slug,
        title: s.title,
        heading: s.heading,
        text: s.text,
        ...(s.does ? { does: s.does } : {}),
      })),
      ids: [],
    },
  })
  const familyRead: MadeRead = {
    tool: 'definitions',
    input: { names: ['Revenue'] },
    ref: 'r2',
    result: {
      counts: { metrics: 1, dimensions: 0, terms: 0 },
      found: 1,
      definitions: [
        {
          id: 'revenue',
          name: 'Revenue',
          kind: 'metric',
          domain: 'Sales',
          owners: ['Jon Abara', 'Sofia Brandt'],
          otherNames: [],
          words: 'What was sold.',
          from: 'Cube',
          does: ['pick_usual_variant', 'family_meaning'],
          sameAs: null,
          state: 'current',
          items: 3,
          values: null,
          related: null,
          history: null,
        },
      ],
      more: 0,
      notFound: [],
      names: [
        { id: 'metric:revenue', name: 'Revenue', of: null, type: null },
        { id: 'domain:area_sales', name: 'Sales', of: null, type: null },
      ],
      ids: ['revenue'],
    },
  }

  it('offers the action a help part explains when the words mark it, and drops the mark from the words', () => {
    const t = turnOf(
      'Open Context and choose New context: the editor opens on a new item [do:write_context].',
      [helpRead('create my first context item')],
      [],
      'How do I create my first context item?',
    )
    expect(t.actions).toEqual([{ id: 'write_context' }])
    expect(t.text).not.toMatch(/do:|\[/)
    expect(t.said).not.toMatch(/do:/)
  })

  it('offers nothing the words do not mark, nor what no read offered, nor past two', () => {
    const words = 'Open Context and choose New context.'
    expect(turnOf(words, [helpRead('create my first context item')], [], 'How?').actions).toBe(
      undefined,
    )
    const t = turnOf(
      'Invite them in People [do:invite_people] [do:connect_source] [do:fly_away]. Then connect an agent [do:connect_agent] [do:add_domain].',
      [helpRead('invite a colleague'), helpRead('connect a source like dbt', 'r2')],
      [],
      'How do I invite a colleague and connect a source?',
    )
    expect(t.actions).toEqual([{ id: 'invite_people' }, { id: 'connect_source' }])
    expect(t.checks.filter((c) => c.kind === 'action').map((c) => c.words)).toEqual([
      '[do:fly_away]',
      '[do:connect_agent]',
      '[do:add_domain]',
    ])
  })

  it("takes a family's action with the family a definitions read found, over the help's", () => {
    const t = turnOf(
      'An owner of Sales, or an admin, picks the usual variant in its quick view [do:pick_usual_variant].',
      [helpRead('usual variant of a metric family'), familyRead],
      [],
      'How do I pick the usual variant of Revenue?',
    )
    expect(t.actions).toEqual([
      {
        id: 'pick_usual_variant',
        family: {
          name: 'Revenue',
          domain: 'domain:area_sales',
          owners: ['Jon Abara', 'Sofia Brandt'],
        },
      },
    ])
  })

  it('offers what an earlier turn read offered, on a follow-up', () => {
    const t = turnOf(
      'Choose Invite people in Settings, People [do:invite_people].',
      [],
      [helpRead('invite a colleague')],
      'And how do I do that?',
    )
    expect(t.actions).toEqual([{ id: 'invite_people' }])
  })
})
