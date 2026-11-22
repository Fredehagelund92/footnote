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

  it('finds the steps for a screen by the words people use for it', () => {
    expect(searchHelp('connect a source like dbt')[0]).toMatchObject({
      slug: 'integrations',
      id: 'connect-a-source',
    })
    expect(searchHelp('create my first context item')[0]).toMatchObject({
      slug: 'write-context',
      id: 'add-a-context-item',
    })
    expect(searchHelp('invite a colleague')[0]).toMatchObject({
      slug: 'domains-and-owners',
      id: 'people',
    })
  })

  it('is no help answer when it cites an item: the context it rests on is its source', () => {
    const t = turnOf('Nothing written covers it.', [searchedNothing], [], 'Why?')
    expect(t.help).toBeUndefined()
    expect(t.state).toBe('missing')
  })
})
