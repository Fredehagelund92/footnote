import { describe, expect, it } from 'vitest'
import type { LoopBlock, LoopLink, LoopRun } from '../../src/contract/answer.ts'
import type { Mark } from '../../src/domain/markdown-blocks.ts'
import {
  addressesIn,
  blockRuns,
  finishedWords,
  linkOf,
} from '../../src/server/modules/answer/loop-body.ts'
import { turnOf, type MadeRead } from '../../src/server/modules/answer/index.ts'

/*
  The Markdown the model writes in an answer of Ask's loop, drawn as the page draws it: bold,
  italics, code and links as marks on the words, numbered lists, short tables and lines of code
  as blocks, never as their asterisks, pipes and fences. The plain words (what Copy copies) carry
  no Markdown; what the chat sends back keeps it. A link goes only to a web or mail address or a
  help page. While the words stream in, a sentence waits until the mark it opens is closed.
*/

/** A read of the help, as a question about Footnote itself makes it. */
const help: MadeRead = {
  tool: 'help',
  ref: 'r1',
  input: { words: 'create a context item' },
  result: {
    words: 'create a context item',
    found: 1,
    pages: [
      {
        page: 'write-context#what-to-put-in-it',
        title: 'Write context',
        heading: 'What to put in it',
        text: 'A title that is one plain sentence, with its date.',
      },
    ],
    ids: [],
  },
}
/** A look-up that names Tickets closed and cites one item. */
const lookup: MadeRead = {
  tool: 'get_context',
  ref: 'r2',
  input: { about: 'tickets closed' },
  result: {
    state: 'grounded',
    read: {
      words: 'tickets closed',
      names: ['Tickets closed'],
      about: ['metric:tickets_closed'],
      period: 'any date',
      assumedToday: false,
    },
    items: [
      {
        id: 'itm_aaaa1111',
        title: 'Reopened tickets count once',
        summary: 'A reopened ticket counts once.',
        kind: 'rule',
        domain: 'Support',
        domainId: 'domain:area_support',
        about: ['metric:tickets_closed'],
        checked: { role: 'the owner of Support', date: '2026-10-02' },
        outOfDate: null,
      },
    ],
    nearby: [],
    uncovered: [],
    wider: null,
    owners: [],
    searched: [],
    outOf: { count: 3, of: 'published context items you can see' },
    more: 0,
    names: [{ id: 'metric:tickets_closed', name: 'Tickets closed', of: null, type: null }],
    ids: ['itm_aaaa1111'],
  },
}

const text = (s: string, marks?: Mark[], link?: LoopLink): LoopRun => ({
  t: 'text',
  text: s,
  ...(marks ? { marks } : {}),
  ...(link ? { link } : {}),
})
/** Every run of words the blocks draw. */
const wordsIn = (body: readonly LoopBlock[]) =>
  body.flatMap((b) => [...blockRuns(b), ...(b.t === 'code' ? [text(b.text)] : [])])
/** No asterisk, underscore pair, backtick or pipe of the Markdown is left in the words drawn. */
const noMarkdown = (body: readonly LoopBlock[]) => {
  for (const r of wordsIn(body))
    if (r.t === 'text' && !r.marks?.includes('code'))
      expect(r.text).not.toMatch(/\*\*|__|~~|`|^\s*\||\|\s*$/)
}

describe("the model's Markdown in an answer from the help", () => {
  it("draws each list line's bold label in bold, not with its asterisks (the captain's answer)", () => {
    const written = [
      'To write your first context item, open Write and fill in what agents should know.',
      '',
      '- **Properties:** the Domain, the Kind, the Status and the owners.',
      '- **Applies to:** the metrics and markets it is about.',
      '- **Source:** a link anyone can open.',
    ].join('\n')
    const t = turnOf(written, [help], [])
    expect(t.help?.map((h) => h.slug)).toEqual(['write-context'])
    expect(t.body.map((b) => b.t)).toEqual(['p', 'ul'])
    const ul = t.body[1]!
    expect(ul.t === 'ul' && ul.items[0]).toEqual([
      text('Properties:', ['bold']),
      text(' the Domain, the Kind, the Status and the owners.'),
    ])
    expect(ul.t === 'ul' && ul.items.map((i) => i[0])).toEqual([
      text('Properties:', ['bold']),
      text('Applies to:', ['bold']),
      text('Source:', ['bold']),
    ])
    noMarkdown(t.body)
    // Copy copies the plain words; the chat sends back the words as the model wrote them.
    expect(t.text).toBe(
      [
        'To write your first context item, open Write and fill in what agents should know.',
        '',
        '- Properties: the Domain, the Kind, the Status and the owners.',
        '- Applies to: the metrics and markets it is about.',
        '- Source: a link anyone can open.',
      ].join('\n'),
    )
    expect(t.said).toBe(written)
  })

  it('draws bold, italics, struck words and code as marks, and leaves words Markdown does not mark', () => {
    const t = turnOf(
      'It is **Due** or *Live*, never _Archived_ or ~~Draft~~, and `get_context` reads `items[0]`.\n\nKeep snake_case, 2 * 3 * 4 and a \\*star\\* as they are.',
      [help],
      [],
    )
    expect(t.body[0]).toEqual({
      t: 'p',
      runs: [
        text('It is '),
        text('Due', ['bold']),
        text(' or '),
        text('Live', ['italic']),
        text(', never '),
        text('Archived', ['italic']),
        text(' or '),
        text('Draft', ['strike']),
        text(', and '),
        text('get_context', ['code']),
        text(' reads '),
        // Brackets set as code cite nothing.
        text('items[0]', ['code']),
        text('.'),
      ],
    })
    expect(t.body[1]).toEqual({
      t: 'p',
      runs: [text('Keep snake_case, 2 * 3 * 4 and a *star* as they are.')],
    })
    expect(t.text).toBe(
      'It is Due or Live, never Archived or Draft, and get_context reads items[0].\n\nKeep snake_case, 2 * 3 * 4 and a *star* as they are.',
    )
  })

  it('keeps a mention, a citation and a number reference as they are inside a mark', () => {
    const t = turnOf(
      '**[@metric:tickets_closed]** has *one rule* [itm_aaaa1111], out of **[#r2.outOf.count]**.',
      [lookup],
      [],
    )
    const runs = blockRuns(t.body[0]!)
    expect(runs).toContainEqual({ t: 'noun', id: 'metric:tickets_closed' })
    expect(runs).toContainEqual({ t: 'cite', n: 1 })
    expect(runs).toContainEqual(text('one rule', ['italic']))
    expect(runs.some((r) => r.t === 'count')).toBe(true)
    noMarkdown(t.body)
    expect(t.sources).toEqual(['itm_aaaa1111'])
  })

  it('carries a mark across the sentences it spans', () => {
    const t = turnOf('**It counts once. It counts as one.** The rest is plain.', [help], [])
    expect(blockRuns(t.body[0]!)).toEqual([
      text('It counts once. It counts as one.', ['bold']),
      text(' The rest is plain.'),
    ])
  })
})

describe('the links the model writes', () => {
  const given = addressesIn(
    'Source: https://footnote.dev/docs, and mail ada@example.com at mailto:ada@example.com.',
  )

  it('links to a help page at one of its parts, or to an address the reads give word for word', () => {
    expect([...given]).toEqual(['https://footnote.dev/docs', 'mailto:ada@example.com'])
    expect(linkOf('https://footnote.dev/docs', given)).toEqual({ url: 'https://footnote.dev/docs' })
    expect(linkOf('mailto:ada@example.com', given)).toEqual({ url: 'mailto:ada@example.com' })
    expect(linkOf('review-a-suggestion.md', given)).toEqual({ slug: 'review-a-suggestion', id: '' })
    expect(linkOf('write-context#the-four-kinds', given)).toEqual({
      slug: 'write-context',
      id: 'the-four-kinds',
    })
    // Never a script, a path out of the help, or an address of the model's own making: words in
    // an item could have it put what the chat says into one.
    expect(linkOf('javascript:alert(1)', given)).toBeNull()
    expect(linkOf('JavaScript:alert(1)', given)).toBeNull()
    expect(linkOf('data:text/html,<script>alert(1)</script>', given)).toBeNull()
    expect(linkOf('../../etc/passwd', given)).toBeNull()
    expect(linkOf('//evil.example', given)).toBeNull()
    expect(linkOf('https://evil.example/?q=orders+fell', given)).toBeNull()
    expect(linkOf('https://footnote.dev/docs?q=orders+fell', given)).toBeNull()
  })

  it('draws a link on its words, and words whose link may go nowhere as plain words', () => {
    const t = turnOf(
      'See [Review a suggestion](review-a-suggestion.md) and [the site](https://footnote.dev/docs), not [this](javascript:alert(1)) nor [that](https://evil.example/?q=secret).',
      [help],
      [],
      'What does https://footnote.dev/docs say about review?',
    )
    expect(blockRuns(t.body[0]!)).toEqual([
      text('See '),
      text('Review a suggestion', undefined, { slug: 'review-a-suggestion', id: '' }),
      text(' and '),
      text('the site', undefined, { url: 'https://footnote.dev/docs' }),
      text(', not this nor that.'),
    ])
    expect(t.text).toBe('See Review a suggestion and the site, not this nor that.')
  })

  it('draws no raw HTML: a tag the model writes is its words', () => {
    const t = turnOf('A <script>alert(1)</script> and <b>bold</b> stay words.', [help], [])
    expect(blockRuns(t.body[0]!)).toEqual([
      text('A <script>alert(1)</script> and <b>bold</b> stay words.'),
    ])
  })
})

describe("the model's numbered lists, tables, code and headings", () => {
  it('draws a numbered list from its first number, one list across blank lines', () => {
    const t = turnOf(
      'Three steps:\n\n1. Open **Write**.\n\n2. Pick a kind.\n3. Publish it.\n\nThen it is live.',
      [help],
      [],
    )
    expect(t.body.map((b) => b.t)).toEqual(['p', 'ul', 'p'])
    const ul = t.body[1]!
    expect(ul.t === 'ul' && ul.start).toBe(1)
    expect(ul.t === 'ul' && ul.items).toEqual([
      [text('Open '), text('Write', ['bold']), text('.')],
      [text('Pick a kind.')],
      [text('Publish it.')],
    ])
    expect(t.text).toBe(
      'Three steps:\n\n1. Open Write.\n2. Pick a kind.\n3. Publish it.\n\nThen it is live.',
    )
    const from = turnOf('3. Third.\n4. Fourth.', [help], []).body[0]!
    expect(from.t === 'ul' && from.start).toBe(3)
    // A list of dashes has no number; a numbered line after it starts a list of its own.
    const two = turnOf('- One.\n- Two.\n1. Next.', [help], []).body
    expect(two.map((b) => b.t === 'ul' && b.start)).toEqual([undefined, 1])
  })

  it('draws a short table as its heads and rows, each cell with its marks and citations', () => {
    const t = turnOf(
      [
        'Two kinds:',
        '',
        '| Press | What happens |',
        '| --- | :--- |',
        '| **Still true** | It counts as checked [itm_aaaa1111] |',
        '| Archive | `a \\| b` stops |',
        'Pick one.',
      ].join('\n'),
      [lookup],
      [],
    )
    expect(t.body.map((b) => b.t)).toEqual(['p', 'table', 'p'])
    const table = t.body[1]!
    expect(table.t === 'table' && table.rows).toEqual([
      [[text('Press')], [text('What happens')]],
      [[text('Still true', ['bold'])], [text('It counts as checked '), { t: 'cite', n: 1 }]],
      [[text('Archive')], [text('a | b', ['code']), text(' stops')]],
    ])
    noMarkdown(t.body)
    expect(t.text).toBe(
      'Two kinds:\n\nPress | What happens\nStill true | It counts as checked [1]\nArchive | a | b stops\n\nPick one.',
    )
    expect(t.said).toContain('| **Still true** | It counts as checked [itm_aaaa1111] |')
  })

  it('draws lines written as code as they are, marks and brackets too', () => {
    const t = turnOf(
      'Run this:\n\n```text\nclaude mcp add footnote [**url**]\n\nthen restart\n```\n\nIt asks you to sign in.',
      [help],
      [],
    )
    expect(t.body).toEqual([
      { t: 'p', runs: [text('Run this:')] },
      { t: 'code', text: 'claude mcp add footnote [**url**]\n\nthen restart' },
      { t: 'p', runs: [text('It asks you to sign in.')] },
    ])
    expect(t.text).toContain('claude mcp add footnote [**url**]')
  })

  it('flags a figure the model invents inside lines written as code, and keeps the code as written', () => {
    const t = turnOf('Run this:\n\n```text\nretry 57 times\n```', [help], [])
    expect(t.body).toContainEqual({ t: 'code', text: 'retry 57 times' })
    expect(t.checks).toContainEqual({ kind: 'digits', words: '57' })
  })

  it('draws a heading as a line in bold, a quote as its words, and a rule as nothing', () => {
    const t = turnOf(
      '## The four *kinds*\n\n> **Events** happen on a date.\n\n---\n\nThat is all.',
      [help],
      [],
    )
    expect(t.body).toEqual([
      {
        t: 'p',
        runs: [text('The four ', ['bold']), text('kinds', ['bold', 'italic'])],
      },
      { t: 'p', runs: [text('Events', ['bold']), text(' happen on a date.')] },
      { t: 'p', runs: [text('That is all.')] },
    ])
  })
})

describe('the words while they stream in', () => {
  it('shows a sentence only once the mark it opens is closed, so no asterisk flashes', () => {
    expect(finishedWords('A first sentence. **A bold start. And more')).toBe('A first sentence.')
    expect(finishedWords('A first sentence. **A bold start. And more** done. Next')).toBe(
      'A first sentence. **A bold start. And more** done.',
    )
    expect(finishedWords('- **Properties:** the Domain\n- **Appl')).toBe(
      '- **Properties:** the Domain',
    )
    expect(finishedWords('- **Properties:** the Domain\n- **Applies to:** the metrics\n')).toBe(
      '- **Properties:** the Domain',
    )
    // A sentence that ends inside its mark ends there.
    expect(finishedWords('**Done.** Next words')).toBe('**Done.**')
    // A star that marks nothing holds nothing back.
    expect(finishedWords('It is 2 * 3. Next')).toBe('It is 2 * 3.')
  })
})
