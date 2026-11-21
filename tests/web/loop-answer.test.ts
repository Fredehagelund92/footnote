// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LoopTurn } from '@contract/answer'
import { dimensionHue } from '@domain/ask-nouns'
import { answerLines } from '@domain/words'
import examples from '@/api/mock/data/loop-examples.json'
import { usedTurn } from '@/api/mock/loop-used'

/*
  Ask's loop answers as the page draws them (direction C, FR-349, FR-718 to FR-720), in every state
  the service wrote on the demo week (src/web/api/mock/data/loop-examples.json, written by
  tests/web/integration/ask-loop-shapes.test.ts), and on a workspace of teams and sprints: the
  state and its fixed sentence, the words with their chips, the evidence in its fixed order, an
  overview's groups, and every chip a button that says what it is, whose card opens on a press.
*/

const world = vi.hoisted(() => ({
  me: { name: 'Jon Abara', role: 'Owner of Sales, admin', owns: ['area_sales'], admin: true },
  writes: [] as { op: string; input: unknown }[],
}))
vi.mock('@/lib/workspace', () => ({
  useFacts: () => [],
  useFact: () => undefined,
  useMe: () => world.me,
  useDomains: () => ({
    area_sales: {
      id: 'area_sales',
      name: 'Sales',
      owners: ['Jon Abara'],
      covers: 'Orders.',
      text: '',
    },
  }),
  usePeople: () => [world.me, { name: 'Ravi Kapoor', role: 'Admin', owns: [], admin: true }],
}))
vi.mock('@/lib/definitions', () => ({ useDefinitions: () => [] }))
vi.mock('@/api/queries', () => ({
  useWrite: () => (op: string, input: unknown) => {
    world.writes.push({ op, input })
    return Promise.resolve({ id: 'g1' })
  },
}))
vi.mock('@/lib/dock', () => ({ openDock: vi.fn(), useDock: () => null }))
// Reading items ahead needs the app's query cache, which a static drawing has not.
vi.mock('@/lib/read-ahead', () => ({ useReadAhead: () => () => ({}), useReadCitedAhead: () => {} }))
vi.mock('@/lib/shown-answers', () => ({ answerKey: () => 'k', keepShown: () => {} }))
vi.mock('@/lib/router', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRoute: () => ({ path: '/ask', query: new URLSearchParams() }),
}))

const { LoopAnswerBody } = await import('@/components/footnote/loop-answer')
const { loopParts } = await import('@/components/footnote/loop-parts')
const { AnswerActions, ReportLine, SomethingWrong } = await import('@/components/footnote/answer')
// The figure reads the data through the app's query cache: here, where it goes is enough.
const AnswerFigure = ({ answer }: { answer: { metric: string } }) =>
  React.createElement('p', { 'data-figure': answer.metric })
const parts = { ...loopParts, AnswerActions, ReportLine, SomethingWrong, AnswerFigure }
const { loopAnswerOf } = await import('@/api/http-ask')
const turnModule = await import('@/model/ask-turn')
const { doneTurn } = turnModule

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})
const names = {
  metric: (k: string) => k,
  value: (k: string) => k,
  metricKey: () => undefined,
  marketKey: () => undefined,
}
function render(turn: LoopTurn, question = 'A question?') {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const answer = loopAnswerOf(turn, question, names)
  act(() =>
    root!.render(
      React.createElement(LoopAnswerBody, { parts, turn: doneTurn(answer), latest: true }),
    ),
  )
  return host
}
const example = (id: keyof typeof examples) => examples[id].turn as unknown as LoopTurn
/** The words on screen: what a screen reader alone hears (`sr-only`) left out. */
const text = (el: Element) => {
  const shown = el.cloneNode(true) as Element
  for (const hidden of shown.querySelectorAll('.sr-only')) hidden.remove()
  return shown.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}
/** A control's name: its label, or what it says, a screen reader's words included. */
const nameOf = (el: Element) => {
  const label = el.getAttribute('aria-label')
  if (label) return label
  const said = el.cloneNode(true) as Element
  for (const hidden of said.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return said.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}
const buttons = (el: Element, name: RegExp) =>
  [...el.querySelectorAll('[role="button"], button')].filter((b) =>
    name.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  )

describe("Ask's loop answer, state by state", () => {
  it('Checked: no sentence beside the state, the words with chips, then what was used', () => {
    const el = render(example('loop-checked'))
    expect(text(el)).toContain('Checked')
    expect(text(el)).not.toContain('This is written down and checked.')
    expect(buttons(el, /^Orders, metric$/)).toHaveLength(1)
    expect(buttons(el, /, value$/).length).toBeGreaterThan(0)
    // What it rests on, as a chip with its title under the words, without a press.
    const item = example('loop-checked').items.find((i) => i.n === 1)!
    const chips = el.querySelector('[data-sources]')!
    expect(text(chips)).toContain(item.title)
    expect(buttons(chips, /^Source 1: /)).toHaveLength(1)
  })

  it('Not found: one sentence, the closest written counted by value with four rows, the owners, and Write context', () => {
    const el = render(example('loop-missing'))
    expect(text(el)).toContain('Nothing is written about this yet.')
    expect(text(el)).toContain('Written nearest about')
    const rows = el.querySelectorAll('li')
    expect(rows.length).toBe(4)
    const more = [...el.querySelectorAll('button')].find((b) => /^Show \d+ more$/.test(text(b)))
    expect(more).toBeDefined()
    act(() => more!.click())
    expect(el.querySelectorAll('li').length).toBe(example('loop-missing').closest!.items.length)
    // The gap card: what is not written, and, to its owner, Write context for it.
    const gap = el.querySelector('[data-gap]')!
    expect(gap.getAttribute('aria-label')).toBe('Not written yet: Orders in Poland')
    expect(text(gap)).toMatch(
      /^Orders in PolandNo context item covers it yet\. It is yours to write/,
    )
    expect(buttons(gap, /^Write context for Orders in Poland$/)).toHaveLength(1)
    expect(text(el)).toMatch(/^.*0 of 21 published context items you can see apply/)
  })

  it('Stopped: one sentence first, then the plain read with its answer line and evidence', () => {
    const sentence =
      'Ask stopped at its time limit of 30 seconds before it had an answer, so this is what is written, as agents get it.'
    // A stop is a stop: the service gives it no state, and the page says Stopped in its place.
    const el = render({
      ...example('loop-missing'),
      kind: 'stopped',
      text: sentence,
      stopped: 'time',
      state: null,
    })
    const shown = text(el)
    expect(shown.startsWith(`Stopped${sentence}`)).toBe(true)
    expect(shown).not.toMatch(/Not found|Checked|Partial/)
    expect(el.querySelector('[data-gap]')).toBeNull()
    expect(shown).not.toContain('Nothing it wrote was checked')
  })

  it('Not found, for a reader who may not write: Tell the owner, which files the subject and says it was sent', async () => {
    const owner = world.me
    world.me = { name: 'Ines Duarte', role: 'Suggests context', owns: [], admin: false }
    world.writes.length = 0
    try {
      const el = render(example('loop-missing'))
      expect(text(el)).not.toMatch(/Write context/)
      const tell = [...el.querySelectorAll('button')].find((b) => text(b) === 'Tell the owner')
      expect(tell).toBeDefined()
      expect(text(el.querySelector('[data-gap]')!)).toContain(
        'Jon Abara and Sofia Brandt, the owners of Sales, can write it.',
      )
      expect(text(el.querySelector('[data-gap]')!)).toContain(
        'Only what it is about is sent, never your words.',
      )
      await act(async () => {
        tell!.click()
        await Promise.resolve()
      })
      // The subject's metric and values, and no date since none was named: nothing of the words.
      expect(world.writes).toEqual([
        { op: 'tellOwner', input: { about: ['metric:orders', 'value:market/poland'] } },
      ])
      // Before: who can write it, by name, and that only what it is about is sent.
      // After: who was told, by name.
      expect(text(el.querySelector('[data-gap]')!)).toContain(
        'Sent to Jon Abara and Sofia Brandt, the owners of Sales. It waits in their Inbox.',
      )
      expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Tell the owner')).toBe(
        false,
      )
    } finally {
      world.me = owner
    }
  })

  const ebitda = (): LoopTurn => ({
    ...example('loop-missing'),
    state: null,
    subject: null,
    owners: [],
    closest: null,
    text: 'Nothing written covers EBITDA, so Ask has no definition of it to give you.',
    body: [
      {
        t: 'p',
        runs: [
          {
            t: 'text',
            text: 'Nothing written covers EBITDA, so Ask has no definition of it to give you.',
          },
        ],
      },
    ],
    unknown: ['EBITDA'],
  })

  it('A word the reads found nothing under: Tell an admin sends the word alone, and says who was told', async () => {
    const owner = world.me
    world.me = { name: 'Ines Duarte', role: 'Suggests context', owns: [], admin: false }
    world.writes.length = 0
    try {
      const el = render(ebitda(), 'What is our EBITDA definition?')
      const gap = el.querySelector('[data-gap]')!
      expect(gap.getAttribute('aria-label')).toBe('Not written yet: “EBITDA”')
      expect(text(gap)).toContain(
        'No metric, other name or context item uses this word yet. Ravi Kapoor, an admin, can add it.',
      )
      expect(text(gap)).toContain('Only this word is sent, never your question.')
      const tell = buttons(gap, /^Tell an admin$/)
      expect(tell).toHaveLength(1)
      await act(async () => {
        ;(tell[0] as HTMLElement).click()
        await Promise.resolve()
      })
      expect(world.writes).toEqual([{ op: 'tellOwner', input: { about: [], word: 'EBITDA' } }])
      expect(text(gap)).toContain('Sent to Ravi Kapoor, an admin. It waits in their Inbox.')
    } finally {
      world.me = owner
    }
  })

  it('A word the reads found nothing under, to an admin: Add it to Definitions', () => {
    const el = render(ebitda(), 'What is our EBITDA definition?')
    const gap = el.querySelector('[data-gap]')!
    expect(text(gap)).toContain('It is yours to add.')
    expect(buttons(gap, /^Add it to Definitions$/)).toHaveLength(1)
    expect(buttons(gap, /^Tell/)).toHaveLength(0)
  })

  it('makes the chips and the citations the buttons in the words, never a sentence', () => {
    const el = render(example('loop-conflict'))
    const words = el.querySelector('[data-answer-words]')!
    const pressable = [...words.querySelectorAll('[role="button"], button, [tabindex]')]
    expect(pressable.length).toBeGreaterThan(0)
    for (const b of pressable)
      expect(b.getAttribute('aria-label') ?? b.textContent).toMatch(
        /, (?:metric|value|dimension|domain|person)$|^Source \d+: /,
      )
    for (const block of words.querySelectorAll('p, li, span:not([role])'))
      expect([block.getAttribute('role'), block.getAttribute('tabindex')]).toEqual([null, null])
  })

  it('leaves the owners out when the words already name each of them', () => {
    const turn = example('loop-missing')
    const people = turn.owners.flatMap((o) => o.people)
    expect(people.length).toBeGreaterThan(0)
    const named: LoopTurn = {
      ...turn,
      body: [
        ...turn.body,
        {
          t: 'p',
          runs: [
            { t: 'text', text: 'Its owners are ' },
            ...people.map((id) => ({ t: 'noun' as const, id })),
          ],
        },
      ],
    }
    expect(text(render(named)).match(/owned by/g)).toBeNull()
  })

  it('says a domain once to a screen reader when the words after its chip name it (F9)', () => {
    const turn = example('loop-missing')
    const domain = turn.nouns.find((n) => n.id.startsWith('domain:'))!
    const owned = (after: string): LoopTurn => ({
      ...turn,
      body: [
        {
          t: 'p',
          runs: [
            { t: 'text', text: 'Jon Abara owns it in the ' },
            { t: 'noun', id: domain.id },
            { t: 'text', text: after },
          ],
        },
      ],
    })
    // What a screen reader reads: the words shown and those only it hears.
    const heard = (turn: LoopTurn) => render(turn).textContent.replace(/\s+/g, ' ')
    expect(heard(owned(' domain.'))).toContain(`owns it in the ${domain.name} domain.`)
    expect(heard(owned(', which has no rule.'))).toContain(
      `owns it in the ${domain.name}, domain, which has no rule.`,
    )
  })

  it('Conflict: the two that disagree side by side, who decides, and Compare the two', () => {
    const el = render(example('loop-conflict'))
    expect(text(el)).toContain('Two items say different things.')
    expect(text(el)).toContain('These two disagree')
    expect(text(el)).toMatch(/Which one holds is for the owners of Sales and Paid media to decide/)
    expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Compare the two')).toBe(true)
  })

  it('Outdated: the item stays in sight saying it may be out of date, and an admin can mark it still true', () => {
    const el = render(example('loop-stale'))
    expect(text(el)).toContain('Some of this may be old.')
    expect(text(el.querySelector('[data-pinned]')!)).toContain('May be out of date')
    expect([...el.querySelectorAll('button')].some((b) => text(b) === 'Mark it still true')).toBe(
      true,
    )
    // The day a read gave is drawn as a day, never as the model's digits.
    expect(el.querySelector('time')?.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('Sources: the first three as chips with their titles, the rest behind +n', () => {
    const turn = usedTurn(5)
    const el = render(turn)
    const chips = el.querySelector('[data-sources]')!
    // A chip's name is what it shows: its number, its title and the day it was checked.
    const named = () => buttons(chips, /^Source \d+: /).map(nameOf)
    expect(named().map((name) => name.replace(/, checked .+$/, ''))).toEqual(
      turn.items.slice(0, 3).map((i) => `Source ${i.n}: ${i.title}`),
    )
    for (const name of named()) expect(name).toMatch(/, checked \d+ \w+ \d{4}$/)
    for (const i of turn.items.slice(0, 3)) expect(text(chips)).toContain(i.title)
    const more = buttons(chips, /^Show 2 more sources$/)
    expect(more).toHaveLength(1)
    expect(text(more[0]!)).toBe('+2')
    act(() => (more[0] as HTMLElement).click())
    expect(named()).toHaveLength(5)
    expect(buttons(chips, /more sources?$/)).toHaveLength(0)
  })

  it('Sources: pointing at a chip lights its marks in the words', () => {
    const el = render(usedTurn(2))
    const chip = buttons(el.querySelector('[data-sources]')!, /^Source 2: /)[0] as HTMLElement
    const marks = () =>
      buttons(el.querySelector('[data-answer-words]')!, /^Source 2: /) as HTMLElement[]
    expect(marks().length).toBeGreaterThan(0)
    expect(marks().every((m) => !m.className.includes('bg-foreground'))).toBe(true)
    act(() => chip.focus())
    expect(marks().every((m) => m.className.includes('bg-foreground'))).toBe(true)
    // Only its own number's marks.
    const first = buttons(el.querySelector('[data-answer-words]')!, /^Source 1: /) as HTMLElement[]
    expect(first.every((m) => !m.className.includes('bg-foreground'))).toBe(true)
    act(() => chip.blur())
    expect(marks().every((m) => !m.className.includes('bg-foreground'))).toBe(true)
  })

  it('Sources: an item due, out of date or archived is never a chip; it stays under them, one line each', () => {
    const base = usedTurn(5)
    const el = render({
      ...base,
      items: base.items.map((i, k) =>
        k === 1
          ? { ...i, status: 'due' as const }
          : k === 2
            ? { ...i, outOfDate: 'its check date has passed' }
            : k === 4
              ? { ...i, status: 'archived' as const }
              : i,
      ),
    })
    const sources = el.querySelector('[data-sources]')!
    const pinned = [...sources.querySelectorAll('[data-pinned] > li')]
    expect(pinned.map((li) => buttons(li, /^Source \d+: /)[0]?.getAttribute('aria-label'))).toEqual(
      [
        expect.stringMatching(/^Source 2: /),
        expect.stringMatching(/^Source 3: /),
        expect.stringMatching(/^Source 5: /),
      ],
    )
    expect(pinned.map(text)).toEqual([
      expect.stringContaining('Due for a check'),
      expect.stringContaining(answerLines.stale.long),
      expect.stringContaining('Archived'),
    ])
    // The live ones are the chips: sources 1 and 4.
    const chips = [...sources.querySelectorAll('ul[aria-label="Sources"] > li')]
    expect(chips.map((li) => nameOf(buttons(li, /^Source \d+: /)[0]!))).toEqual([
      expect.stringMatching(/^Source 1: /),
      expect.stringMatching(/^Source 4: /),
    ])
  })

  it('Sources: each pinned item due for a check has its own Mark it still true, naming its title', () => {
    const base = usedTurn(4, { look: 2 })
    const turn = {
      ...base,
      items: base.items.map((i, k) =>
        k === 2 ? { ...i, status: 'due' as const, outOfDate: null } : i,
      ),
    }
    const el = render(turn)
    const pinned = [...el.querySelectorAll('[data-sources] [data-pinned] > li')]
    expect(pinned).toHaveLength(2)
    const marks = pinned.map((li) => buttons(li, /^Mark it still true/))
    expect(marks.map((b) => b.map((m) => m.getAttribute('aria-label')))).toEqual([
      [`Mark it still true: ${turn.items[1]!.title}`],
      [`Mark it still true: ${turn.items[2]!.title}`],
    ])
    // None is left that does not say which item it marks.
    expect(buttons(el, /^Mark it still true$/)).toHaveLength(0)
    world.writes.length = 0
    act(() => (marks[1]![0] as HTMLElement).click())
    expect(world.writes.map((w) => [w.op, (w.input as { id: string }).id])).toEqual([
      ['editItem', turn.items[2]!.id],
    ])
  })

  it('Sources: an answer whose items are all live pins none', () => {
    const el = render(usedTurn(4))
    expect(el.querySelectorAll('[data-sources] [data-pinned]')).toHaveLength(0)
  })

  it("A list: the count bold with what it is out of, then the read's items as rows", () => {
    const el = render(example('loop-list'))
    const bold = [...el.querySelectorAll('.font-semibold.tabular-nums')].map(text)
    expect(bold.length).toBeGreaterThanOrEqual(2)
    expect(el.querySelectorAll('li').length).toBe(
      example('loop-list').body.find((b) => b.t === 'list')?.t === 'list'
        ? (example('loop-list').body.find((b) => b.t === 'list') as { rows: string[] }).rows.length
        : 0,
    )
    expect(text(el)).toContain('From Footnote')
  })

  it("A long answer: the model's short list as a list, each line with its citation", () => {
    const el = render(example('loop-long'))
    const lines = [...el.querySelectorAll('ul.list-disc > li')]
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) expect(buttons(line, /^Source \d+: /).length).toBe(1)
  })

  it('A long paragraph: one sentence a line, five at most, then Show more; no "Nothing is written" once items were found', () => {
    const base = example('loop-checked')
    const turn: LoopTurn = {
      ...base,
      state: 'partial',
      subject: { ...base.subject!, uncovered: ['metric:orders'] },
      body: [
        {
          t: 'p',
          runs: Array.from({ length: 8 }, (_, i) => [
            { t: 'text' as const, text: `Sentence ${i + 1} of the answer` },
            { t: 'cite' as const, n: 1 },
            { t: 'text' as const, text: '. ' },
          ]).flat(),
        },
      ],
    }
    const el = render(turn)
    const lines = () => [...el.querySelectorAll('[data-answer-words] p')]
    expect(lines()).toHaveLength(5)
    expect(text(el)).not.toContain('Nothing is written about')
    const more = [...el.querySelectorAll('button')].find((b) => text(b) === 'Show 3 more')
    expect(more).toBeDefined()
    act(() => more!.click())
    expect(lines()).toHaveLength(8)
    expect(text(el)).not.toMatch(/Show \d+ more/)
  })

  it('The figure: an answer reads the data of its subject, after the evidence; a question back and an overview do not', () => {
    const answer = render(example('loop-checked'))
    expect(answer.querySelector('[data-figure]')).not.toBeNull()
    for (const id of ['loop-question', 'loop-overview'] as const) {
      act(() => root?.unmount())
      host?.remove()
      expect(render(example(id)).querySelector('[data-figure]'), id).toBeNull()
    }
  })

  it('A list asked for: every line of it up to twelve, unfolded, after five sentences of prose at most', () => {
    const base = example('loop-checked')
    const line = (i: number) => [{ t: 'text' as const, text: `Metric ${i + 1}` }]
    const listed = (n: number): LoopTurn => ({
      ...base,
      body: [
        { t: 'p', runs: [{ t: 'text', text: `The domain has ${n} metrics:` }] },
        { t: 'ul', items: Array.from({ length: n }, (_, i) => line(i)) },
      ],
    })
    const all = render(listed(10), 'List the metrics in the Sales domain')
    expect(all.querySelectorAll('[data-answer-words] li')).toHaveLength(10)
    expect(text(all)).not.toMatch(/Show \d+ more/)
    act(() => root?.unmount())
    host?.remove()
    const long = render(listed(14), 'List the metrics in the Sales domain')
    expect(long.querySelectorAll('[data-answer-words] li')).toHaveLength(12)
    expect([...long.querySelectorAll('button')].some((b) => text(b) === 'Show 2 more')).toBe(true)
  })

  it('Definition: the label in place of a state, for an answer that uses no item', () => {
    const el = render(
      {
        ...example('loop-checked'),
        state: null,
        sources: [],
        defined: { names: ['Orders'], tool: 'Cube', cards: [] },
      },
      'What is orders?',
    )
    expect(text(el)).toMatch(/^Definition/)
    expect(text(el)).not.toMatch(/Checked|Partial|Not found/)
  })

  const card = {
    id: 'metric:orders',
    name: 'Orders',
    kind: 'metric' as const,
    words: 'The value of orders customers completed and paid for, in euros.',
    tool: 'Cube',
    member: 'sales.orders',
    group: 'Revenue',
    domain: { id: 'domain:area_sales', name: 'Sales' },
    owners: ['Jon Abara', 'Sofia Brandt'],
    context: { count: 3, items: [] as string[] },
    inWords: true,
  }
  const defining = (over: Partial<typeof card>, words = 'Orders is the value of paid orders.') => {
    const base = example('loop-checked')
    return {
      ...base,
      state: null,
      sources: [],
      text: words,
      body: [{ t: 'p' as const, runs: [{ t: 'text' as const, text: words }] }],
      defined: { names: ['Orders'], tool: 'Cube', cards: [{ ...card, ...over }] },
    }
  }

  it('Definition card: the source words, where they come from, its domain and owners, and its context', () => {
    const base = example('loop-checked')
    const listed = base.items.map((i) => i.id)
    const el = render(defining({ context: { count: 5, items: listed } }), 'What is orders?')
    const shown = el.querySelector('[data-definition-card]')!
    expect(shown).not.toBeNull()
    // The words give the definition: the card stands in for them, as the answer.
    expect(text(el)).not.toContain('Orders is the value of paid orders.')
    expect(el.querySelector('[data-answer-words] [data-definition-card]')).not.toBeNull()
    expect(text(shown)).toContain('Metric in the Revenue group')
    expect(text(shown)).toContain(card.words)
    expect(text(shown)).toContain('From Cube, as sales.orders')
    expect(text(shown)).toMatch(/Owned by Jon Abara and Sofia Brandt, in Sales/)
    expect(buttons(shown, /^Open the definition$/)).toHaveLength(1)
    // Its context opens in the card: the rows a read of it returned, and how many more it found.
    const see = buttons(shown, /^See the 5 context items$/)[0] as HTMLElement
    expect(see.getAttribute('aria-expanded')).toBe('false')
    act(() => see.click())
    expect(shown.querySelectorAll('li')).toHaveLength(listed.length)
    expect(text(shown)).toContain(`${5 - listed.length} more were found than listed.`)
  })

  it('Definition card: under the words when they say more than the definition, with no rows to open', () => {
    const el = render(
      defining(
        { inWords: false },
        'Orders counts paid orders, and Net revenue starts from them after returns.',
      ),
      'How do orders differ from net revenue?',
    )
    expect(text(el)).toContain('Orders counts paid orders')
    const shown = el.querySelector('[data-definition-card]')!
    expect(el.querySelector('[data-answer-words] [data-definition-card]')).toBeNull()
    expect(text(shown)).toContain('3 context items about it')
    expect(buttons(shown, /^See the/)).toHaveLength(0)
  })

  it('A reply to the chat that read nothing and cites nothing: its words and the actions only', () => {
    const turn: LoopTurn = {
      ...example('loop-checked'),
      text: 'You are welcome.',
      body: [{ t: 'p', runs: [{ t: 'text', text: 'You are welcome.' }] }],
      state: null,
      sources: [],
      subject: null,
      definitions: [],
      read: [],
      footer: { denominator: null, notSeen: null, stale: null },
      reads: [],
      items: [],
      owners: [],
    }
    const el = render(turn, 'thanks!')
    expect(text(el)).toMatch(/^You are welcome\./)
    expect(text(el)).not.toMatch(/What Ask read|Definition|Used|records/)
  })

  it('A decline: its two sentences, then the questions to press, with no state and nothing read', () => {
    const said = [
      "Ask does not answer questions about one person's work.",
      'It can tell you who owns a domain or a metric, who last checked a context item and when, and what changed this week.',
    ]
    const turn: LoopTurn = {
      ...example('loop-checked'),
      text: said.join(' '),
      body: said.map((t) => ({ t: 'p' as const, runs: [{ t: 'text' as const, text: t }] })),
      state: null,
      sources: [],
      subject: null,
      definitions: [],
      read: [],
      footer: { denominator: null, notSeen: null, stale: null },
      reads: [],
      items: [],
      owners: [],
      choices: ['What changed this week?', 'List the conflicts'],
    }
    const el = render(turn, 'what did Tomas write this week?')
    expect(text(el)).toMatch(
      /^Ask does not answer questions about one person's work\.It can tell you who owns a domain or a metric, who last checked a context item and when, and what changed this week\.What changed this week\?List the conflicts/,
    )
    expect(text(el)).not.toMatch(/Checked|Not found|Partial|What Ask read|Used/)
  })

  it('A question back: the question and its readings as choices, with no state', () => {
    const el = render(example('loop-question'))
    expect(text(el)).toContain('Which switch do you mean?')
    expect(text(el)).not.toMatch(/Checked|Not found|Partial/)
  })

  it('An overview: the total of its groups, each group a heading with its count, long ones folded', () => {
    const turn = example('loop-overview')
    const el = render(turn, 'what do i need to handle?')
    const o = turn.overview!
    expect(text(el)).toContain(`${o.total} cards wait on you in your Inbox`)
    const headings = [...el.querySelectorAll('h3')]
    expect(headings.map((h) => h.textContent)).toEqual(o.groups.map((g) => `${g.name}${g.count}`))
    const long = o.groups.find((g) => g.rows.length > 4)!
    const all = [...el.querySelectorAll('button')].find((b) => text(b) === `Show all ${long.count}`)
    expect(all).toBeDefined()
    act(() => all!.click())
    const section = [...el.querySelectorAll('section')].find(
      (s) => s.getAttribute('aria-label') === long.name,
    )!
    expect(section.querySelectorAll('li').length).toBe(long.rows.length)
    // A group a page shows filtered links there.
    expect(
      [...el.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/context?due=1'),
    ).toBe(true)
  })

  it("An overview: each row's citation after its title, one numbering in reading order", () => {
    const turn = example('loop-overview')
    const el = render(turn, 'what do i need to handle?')
    for (const b of buttons(el, /^Show all /)) act(() => (b as HTMLElement).click())
    const cited = [...el.querySelectorAll('section li')].flatMap((li) => {
      const row = li.querySelector('a, button, span.font-medium')!
      // A card's row cites its item after the link; an item's own title carries its number.
      const mark = buttons(li, /^Source \d+: /)[0]
      const own = /, source (\d+)$/.exec(row.textContent ?? '')
      if (!mark && !own) return []
      const title = own ? text(row).slice(0, -own[1]!.length).trim() : text(row)
      if (mark) {
        const [, n, named] = /^Source (\d+): (.*)$/.exec(mark.getAttribute('aria-label')!)!
        expect(row.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(named).toBe(title)
        return [{ n: Number(n), title }]
      }
      // The number is the title's last words.
      expect(row.textContent).toMatch(
        new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      )
      return [{ n: Number(own![1]), title }]
    })
    expect(cited.length).toBeGreaterThan(3)
    // Numbers first come in reading order, 1, 2, 3 …; an item met again keeps its number.
    const first = [...new Set(cited.map((c) => c.n))]
    expect(first).toEqual(first.map((_, i) => i + 1))
    for (const c of cited) expect(cited.find((x) => x.n === c.n)!.title).toBe(c.title)
    expect(cited.length).toBeGreaterThan(first.length)
  })

  it("An overview code drew in the model's place: the model's lead line first, then the total", () => {
    const turn = example('loop-overview')
    const lead: LoopTurn['body'] = [
      {
        t: 'p',
        runs: [
          { t: 'text', text: 'Your Inbox holds ' },
          { t: 'count', value: '20', of: null },
          { t: 'text', text: ' cards.' },
        ],
      },
    ]
    const el = render({ ...turn, body: lead }, 'what do i need to handle?')
    const words = text(el.querySelector('[data-answer-words]')!)
    expect(words.startsWith('Your Inbox holds 20 cards.')).toBe(true)
    expect(words.indexOf('cards wait on you in your Inbox')).toBeGreaterThan(0)
    expect(el.querySelectorAll('[data-answer-words]')).toHaveLength(1)
  })

  it('An overview of the records: by status, what needs a check first', () => {
    const el = render(example('loop-overview-domain'))
    expect(el.querySelector('h3')?.textContent).toMatch(/^due for a check/)
  })
})

describe('while the loop reads', () => {
  it('shows each read as a step, the done ones with what they found and their chips, the current one moving', () => {
    motion(true)
    const { askedTurn } = turnModule
    const turn = {
      ...askedTurn('t1', 'Tickets closed by billing?'),
      reads: {
        steps: [
          {
            runs: [
              { t: 'text' as const, text: 'Looked up what applies to ' },
              { t: 'noun' as const, id: 'value:team/billing' },
              { t: 'text' as const, text: ': ' },
              { t: 'count' as const, value: '2', of: null },
              { t: 'text' as const, text: ' apply' },
            ],
            done: true,
          },
          { runs: [{ t: 'text' as const, text: 'Reading a context item…' }], done: false },
        ],
        nouns: [
          {
            id: 'value:team/billing',
            name: 'Billing',
            of: { id: 'dimension:team', name: 'Team' },
            type: null,
          },
        ],
      },
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    const steps = [...host.querySelectorAll('ol > li')].map(text)
    expect(steps).toEqual(['Looked up what applies to Billing: 2 apply', 'Reading a context item…'])
    expect(buttons(host, /^Billing, value$/)).toHaveLength(1)
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})

/** Whether the person asked for less motion, as the page reads it. */
const motion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
  })) as unknown as typeof window.matchMedia
}

describe('while the loop writes', () => {
  it('shows each sentence that passed the check, then the rest once the answer is in, the words staying put', () => {
    motion(true)
    const { askedTurn, turnReducer } = turnModule
    const whole = example('loop-checked')
    const first: LoopTurn = {
      ...whole,
      body: [{ t: 'p', runs: [{ t: 'text', text: 'The first sentence is final.' }] }],
      text: 'The first sentence is final.',
    }
    let turn = turnReducer(askedTurn('t1', 'Why is the last day short?'), {
      type: 'words',
      words: first,
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(text(host.querySelector('[data-answer-words]')!)).toBe('The first sentence is final.')
    // Still being written: no actions and no evidence yet, and the reads' steps give way to it.
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(host.querySelector('ol')).toBeNull()
    expect(text(host)).not.toContain('Used')
    // Taken back, the reads show again.
    turn = turnReducer(turn, { type: 'words', words: null })
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(host.querySelector('[data-answer-words]')).toBeNull()
    // The whole answer: its words drawn in the same place, and the evidence after them.
    turn = turnReducer(turn, { type: 'words', words: first })
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    const drawn = host.querySelector('[data-answer-words]')
    turn = turnReducer(turn, {
      type: 'done',
      answer: loopAnswerOf(whole, 'Why is the last day short?', names),
    })
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(host.querySelector('[data-answer-words]')).toBe(drawn)
    expect(text(drawn!)).toContain('The payment files for Germany')
    expect(buttons(host, /^Good answer$/)).toHaveLength(1)
  })

  it('types the words in at reading pace, whatever size they arrive in, then shows the rest', () => {
    motion(false)
    const { askedTurn, turnReducer } = turnModule
    // Asked here, before the page's clock is held.
    const asked = askedTurn('t1', 'Why is the last day short?')
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      const whole = example('loop-checked')
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      // The whole answer in one piece.
      const turn = turnReducer(asked, {
        type: 'done',
        answer: loopAnswerOf(whole, 'Why is the last day short?', names),
      })
      act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
      const words = () => text(host!.querySelector('[data-answer-words]')!)
      // None of it yet, and its state keeps its place out of sight.
      expect(words()).toBe('')
      expect(host.querySelector('.invisible')).not.toBeNull()
      expect(buttons(host, /^Good answer$/)).toHaveLength(0)
      act(() => {
        vi.advanceTimersByTime(300)
      })
      const part = words().length
      expect(part).toBeGreaterThan(0)
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      // Every word, a whole word at a time, then the state and the rest.
      expect(words().length).toBeGreaterThan(part)
      expect(words()).toContain('The payment files for Germany')
      expect(host.querySelector('.invisible')).toBeNull()
      expect(buttons(host, /^Good answer$/)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a turn opened from the history at once', () => {
    motion(false)
    const whole = example('loop-checked')
    const turn = doneTurn(loopAnswerOf(whole, 'Why is the last day short?', names))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(React.createElement(LoopAnswerBody, { parts, turn })))
    expect(text(host.querySelector('[data-answer-words]')!)).toContain(
      'The payment files for Germany',
    )
    expect(buttons(host, /^Good answer$/)).toHaveLength(1)
  })
})

describe('the nouns of an answer on any workspace', () => {
  const invented: LoopTurn = {
    ...example('loop-checked'),
    subject: {
      names: ['Tickets closed', 'Billing'],
      about: ['metric:tickets_closed', 'value:team/billing'],
      period: 'any date',
      note: null,
      assumedToday: false,
      carried: false,
      uncovered: [],
    },
    sources: [],
    items: [],
    body: [
      {
        t: 'p',
        runs: [
          { t: 'noun', id: 'metric:tickets_closed' },
          { t: 'text', text: ' for ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: ' and ' },
          { t: 'noun', id: 'value:sprint/s41' },
          { t: 'text', text: '; again ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: '.' },
        ],
      },
    ],
    nouns: [
      { id: 'metric:tickets_closed', name: 'Tickets closed', of: null, type: null },
      {
        id: 'value:team/billing',
        name: 'Billing',
        of: { id: 'dimension:team', name: 'Team' },
        type: 'string',
      },
      {
        id: 'value:sprint/s41',
        name: 'Sprint 41',
        of: { id: 'dimension:sprint', name: 'Sprint' },
        type: 'time',
      },
      { id: 'dimension:team', name: 'Team', of: null, type: 'string' },
    ],
    closest: null,
    owners: [],
    conflict: [],
    state: 'grounded',
  }

  it("draws each value in its own dimension's hue and icon, a chip the first time only", () => {
    const el = render(invented, 'Tickets closed by billing?')
    const billing = buttons(el, /^Billing, value$/)
    expect(billing).toHaveLength(1)
    expect((billing[0] as HTMLElement).style.getPropertyValue('--chip-h')).toBe(
      String(dimensionHue('dimension:team')),
    )
    const sprint = buttons(el, /^Sprint 41, value$/)[0] as HTMLElement
    expect(sprint.style.getPropertyValue('--chip-h')).toBe(String(dimensionHue('dimension:sprint')))
    // A time dimension's value draws a calendar; any other a tag.
    expect(sprint.querySelector('svg')?.getAttribute('class')).toMatch(/calendar/)
    expect(billing[0]!.querySelector('svg')?.getAttribute('class')).toMatch(/tag/)
    expect(text(el)).toContain('; again Billing.')
    expect(text(el)).not.toMatch(/market/i)
    // Drawn again, the first mention is still the chip.
    const answer = loopAnswerOf(invented, 'Tickets closed by billing?', names)
    act(() =>
      root!.render(
        React.createElement(LoopAnswerBody, { parts, turn: doneTurn(answer), latest: true }),
      ),
    )
    expect(buttons(el, /^Billing, value$/)).toHaveLength(1)
  })

  it("opens a value's card on a press, which says what it is a value of", () => {
    const el = render(invented, 'Tickets closed by billing?')
    act(() => (buttons(el, /^Billing, value$/)[0] as HTMLElement).click())
    expect(document.body.textContent).toContain('A value of Team')
  })
})
