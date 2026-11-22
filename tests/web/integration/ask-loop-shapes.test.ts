import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LoopBlock, LoopTurn } from '@contract/answer'
import type { Answer } from '@/model/ask'
import {
  scriptedLoopChoice,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../../src/server/modules/answer/index.ts'
import { askWorld } from './ask-world.ts'

/*
  The shapes of Ask's loop answers on the demo week (FR-349, FR-718 to FR-720), through the real
  service and the browser's own binding, each turn's words scripted as a model would write them:
  typed mentions of what the reads named, references to the reads' numbers, citations, a short
  list, a list of a read's items, and an overview of the Inbox and of the records. What the page
  draws is code's, from the reads, and these hold it: every chip a read named, every count a read's
  own, every row a read's item, an overview's total its groups' sum. With LOOP_SHAPES_OUT set, the
  turns are written there as the mock's examples (src/web/api/mock/data/loop-examples.json).
*/

const JON = 'Jon Abara'
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])

/** What the scripted model has read this turn, by tool: the last read of each, and its ref. */
const readOf = (prompt: ScriptedPrompt, tool: string) => {
  const found = [...prompt.results].reverse().find((r) => r.toolName === tool)
  const value = isObj(found?.value) ? found.value : {}
  return { ...value, ref: typeof value.ref === 'string' ? value.ref : 'r0' } as Obj & {
    ref: string
  }
}
const mention = (id: unknown) => `[@${String(id)}]`

/** One case: the question, who asks, the reads, then the words written from what they returned. */
type Case = {
  id: string
  question: string
  calls: ScriptedStep['calls']
  write: (p: ScriptedPrompt) => ScriptedStep
}

const cases: Case[] = [
  {
    id: 'loop-checked',
    question: "Why is the last day of Germany's orders always low?",
    calls: [
      {
        toolName: 'get_context',
        input: { about: 'orders in Germany', from: '2026-10-01', to: '2026-10-23' },
      },
    ],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const item = arr(r.items)[0]!
      const about = (r.read as Obj).about as string[]
      return {
        text: `The payment files for ${mention(about[1])} reach the source tool the morning after, so the last day of ${mention(about[0])} is always short [${String(item.id)}].`,
      }
    },
  },
  {
    id: 'loop-missing',
    question: 'Give me all about orders in poland',
    calls: [
      {
        toolName: 'get_context',
        input: { about: 'orders in Poland', widen: { without: 'values' } },
      },
    ],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const about = (r.read as Obj).about as string[]
      return { text: `Nothing written covers ${mention(about[0])} in ${mention(about[1])}.` }
    },
  },
  {
    id: 'loop-conflict',
    question: 'Does net revenue in Spain include VAT?',
    calls: [{ toolName: 'get_context', input: { about: 'net revenue in Spain' } }],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const [a, b] = arr(r.items)
      return {
        text: `Two items disagree. One in ${mention(a!.domainId)} says it includes VAT [${String(a!.id)}]; one in ${mention(b!.domainId)} says it excludes VAT [${String(b!.id)}].`,
      }
    },
  },
  {
    id: 'loop-stale',
    question: 'What happened with price promotions in Italy?',
    calls: [{ toolName: 'find_context', input: { words: 'price promotions Italy' } }],
    write: (p) => {
      const r = readOf(p, 'find_context')
      const item = arr(r.items).find((i) => i.outOfDate) ?? arr(r.items)[0]!
      return {
        text: `The regulator paused price promotions in ${mention((item.about as string[]).find((x) => x.startsWith('value:')))}, so discount cost there dropped to near zero [${String(item.id)}]. The item was last checked on [#${r.ref}.items.${arr(r.items).indexOf(item)}.checked.date].`,
      }
    },
  },
  {
    id: 'loop-list',
    question: 'List the events in Sales',
    calls: [
      {
        toolName: 'records',
        input: { kinds: ['event'], domain: 'Sales', status: ['live', 'due'] },
      },
    ],
    write: (p) => {
      const r = readOf(p, 'records')
      return {
        text: `${mention(arr(r.items)[0]?.domainId ?? 'domain:area_sales')} has [#${r.ref}.count] of [#${r.ref}.outOf].\n\n[list:${r.ref}]`,
      }
    },
  },
  {
    id: 'loop-long',
    question: 'What should I know about orders in Norway?',
    calls: [{ toolName: 'get_context', input: { about: 'orders in Norway' } }],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const items = arr(r.items)
      const about = (r.read as Obj).about as string[]
      const pair = items.filter((i) => (i.disagreesWith as string[]).length)
      const lines = items.slice(0, 3).map((i) => `- ${String(i.title)} [${String(i.id)}]`)
      return {
        text: `[#${r.ref}.items.length] items apply to ${mention(about[0])} in ${mention(about[1])}${pair.length ? ', and two of them disagree' : ''}:\n${lines.join('\n')}`,
      }
    },
  },
  {
    id: 'loop-overview',
    question: 'what do i need to handle?',
    calls: [{ toolName: 'inbox', input: { limit: 25 } }],
    write: (p) => ({
      calls: [{ toolName: 'show_overview', input: { from: readOf(p, 'inbox').ref } }],
    }),
  },
  {
    id: 'loop-overview-due',
    question: 'What is out of date?',
    calls: [{ toolName: 'records', input: { status: ['due'], group_by: 'domain', show: 'list' } }],
    write: (p) => ({
      calls: [{ toolName: 'show_overview', input: { from: readOf(p, 'records').ref } }],
    }),
  },
  {
    id: 'loop-overview-domain',
    question: 'How does Sales stand?',
    calls: [{ toolName: 'records', input: { domain: 'Sales', group_by: 'status', show: 'list' } }],
    write: (p) => ({
      calls: [{ toolName: 'show_overview', input: { from: readOf(p, 'records').ref } }],
    }),
  },
  {
    id: 'loop-question',
    question: 'When did the payment provider switch?',
    calls: [{ toolName: 'find_context', input: { words: 'payment provider switch' } }],
    write: () => ({
      calls: [
        {
          toolName: 'ask_back',
          input: { question: 'Which switch do you mean?', choices: ['In France', 'In Spain'] },
        },
      ],
    }),
  },
  {
    id: 'loop-dates-guessed',
    question: 'What happened to orders in Norway in November?',
    calls: [{ toolName: 'get_context', input: { about: 'orders in Norway in November' } }],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const [a, b] = arr(r.items)
      const about = (r.read as Obj).about as string[]
      return {
        text: `Two rules for ${mention(about[0])} in ${mention(about[1])} disagree in November 2025: one counts card and cash payments only [${String(a!.id)}], the other counts store credit too [${String(b!.id)}].`,
      }
    },
  },
  {
    id: 'loop-dates-anchored',
    question: 'What happened to orders in Norway since the customs rule?',
    calls: [
      { toolName: 'get_context', input: { about: 'orders in Norway since the customs rule' } },
    ],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const stop = arr(r.items).find((i) => String(i.title).startsWith('Online sales to Norway'))
      return {
        text: `Online sales to Norway stopped on 4 August 2026 under the customs rule [${String(stop!.id)}].`,
      }
    },
  },
  {
    id: 'loop-definition',
    question: 'What is net revenue?',
    calls: [
      { toolName: 'get_context', input: { about: 'net revenue', no_period: true } },
      { toolName: 'definitions', input: { names: ['net revenue'] } },
    ],
    write: (p) => {
      const d = arr(readOf(p, 'definitions').definitions)[0]!
      return { text: `${mention(`metric:${String(d.id)}`)} is ${String(d.words)}` }
    },
  },
  {
    id: 'loop-unknown',
    question: 'What is our EBITDA definition?',
    calls: [
      { toolName: 'get_context', input: { about: 'EBITDA definition', no_period: true } },
      { toolName: 'definitions', input: { names: ['EBITDA'] } },
    ],
    write: () => ({
      text: 'Nothing written covers EBITDA, so Ask has no definition of it to give you.',
    }),
  },
  {
    // The captain's question, answered from the help in Markdown as a model may write it.
    id: 'loop-help-markdown',
    question: 'lets create my first context',
    calls: [{ toolName: 'help', input: { words: 'create a context item' } }],
    write: () => ({
      text: [
        'To write your first context item, open **Write** and say what agents should *know*. [Write context](write-context.md#what-to-put-in-it) has every part.',
        '',
        '- **Properties:** the Domain, the Kind, the Status and the owners.',
        '- **Applies to:** the metrics and markets it is about, as `Definitions` names them.',
        '- **Source:** a link anyone can open, such as [the customs notice](https://example.com/customs-notice).',
        '',
        '1. Give it a title that is one plain sentence.',
        '2. Say what it is ~~about~~ not, if people mix it up.',
        '3. Publish it.',
        '',
        '| Kind | When to pick it |',
        '| --- | --- |',
        '| **Event** | Something happened on a date |',
        '| **Rule** | A fixed way to read the numbers |',
      ].join('\n'),
    }),
  },
  {
    // The captain's question again, as Ask answers it now: the first step, and the action it marks.
    id: 'loop-help-write',
    question: 'How do I create my first context item?',
    calls: [{ toolName: 'help', input: { words: 'create my first context item' } }],
    write: () => ({
      text: 'Open Context and choose New context. The editor opens on a new item, with its first question: what should agents know? [do:write_context]',
    }),
  },
  {
    id: 'loop-help-invite',
    question: 'How do I invite a colleague?',
    calls: [{ toolName: 'help', input: { words: 'invite a colleague' } }],
    write: () => ({
      text: "An admin invites people in Settings, People, with their addresses, Admin or Member, and the domains they own. An owner who isn't an admin invites from their own domain's page [do:invite_people].",
    }),
  },
  {
    // A metric nothing is written about yet: under Not found the model marks the definition as
    // what answers, and its card offers its owners the first item.
    id: 'loop-definition-unwritten',
    question: 'What is churn rate?',
    calls: [
      { toolName: 'get_context', input: { about: 'churn rate', no_period: true } },
      { toolName: 'definitions', input: { names: ['churn rate'] } },
    ],
    write: (p) => {
      const d = arr(readOf(p, 'definitions').definitions)[0]!
      const id = `metric:${String(d.id)}`
      return { text: `${mention(id)} is ${String(d.words)} [${id}]` }
    },
  },
  {
    id: 'loop-stopped',
    question: 'Give me all about orders in poland',
    calls: [{ toolName: 'get_context', input: { about: 'orders in Poland' } }],
    // A model that keeps reading until the turn stops at its step limit.
    write: (p) => ({
      calls: [{ toolName: 'find_context', input: { words: `orders ${p.step}` } }],
    }),
  },
]

let current: Case | undefined
const world = askWorld({
  // Spain's VAT pair, which the mock marks across two domains, is marked here too.
  allConflicts: true,
  askTrace: {
    loopModel: scriptedLoopChoice('shapes', (prompt) =>
      prompt.step === 0 ? { calls: current!.calls } : current!.write(prompt),
    ),
  },
})

const turns: Record<string, Answer> = {}
const ask = async (c: Case) => {
  current = c
  const api = await world.as(JON)
  const answer = await api.ask({ question: c.question })
  turns[c.id] = answer
  return answer.loop!
}
const runsOf = (body: readonly LoopBlock[]) =>
  body.flatMap((b) =>
    b.t === 'p' ? b.runs : b.t === 'ul' ? b.items.flat() : b.t === 'table' ? b.rows.flat(2) : [],
  )

describe("Ask's loop answers, as the page draws them", () => {
  it('draws each noun as a chip a read named, and each citation as a source', async () => {
    const loop = await ask(cases[0]!)
    const nouns = runsOf(loop.body).filter((r) => r.t === 'noun')
    expect(nouns.length).toBeGreaterThan(1)
    for (const n of nouns) expect(loop.nouns.map((x) => x.id)).toContain(n.id)
    expect(runsOf(loop.body).some((r) => r.t === 'cite')).toBe(true)
    expect(loop.state).toBe('grounded')
    expect(loop.subject?.assumedToday).toBe(false)
    expect(loop.checks).toEqual([])
    // The plain words keep the names and the numbered citations the graders read.
    expect(loop.text).toMatch(/Orders/)
    expect(loop.text).toMatch(/\[1\]/)
  })

  it('lists what is written nearest a Not found, counted by the dimension it narrowed', async () => {
    const loop = await ask(cases[1]!)
    expect(loop.state).toBe('missing')
    expect(loop.sources).toEqual([])
    const by = loop.closest?.by
    expect(by).toMatch(/^dimension:/)
    // Each count is by code from the items listed, for a value of that dimension the question did not name.
    const items = new Map(loop.items.map((i) => [i.id, i]))
    for (const c of loop.closest!.counts) {
      expect(loop.subject?.about).not.toContain(c.id)
      const named = loop.closest!.items.filter((id) => items.get(id)?.about.includes(c.id))
      expect(named.length).toBe(c.count)
    }
    expect(new Set(loop.closest!.items).size).toBe(loop.closest!.items.length)
    expect(loop.owners.length).toBeGreaterThan(0)
    expect(loop.footer.denominator).toMatch(/^0 of \d+ /)
  })

  it('gives Conflict when two applying items an owner marked as disagreeing are in two domains', async () => {
    const loop = await ask(cases[2]!)
    expect(loop.state).toBe('conflict')
    expect(loop.conflict).toHaveLength(2)
    const domains = loop.items.filter((i) => loop.conflict.includes(i.id)).map((i) => i.domain)
    expect(new Set(domains).size).toBe(2)
  })

  it('fills a number reference from its read, and marks an item that may be out of date', async () => {
    const loop = await ask(cases[3]!)
    expect(runsOf(loop.body).some((r) => r.t === 'date')).toBe(true)
    expect(loop.state).toBe('stale')
    expect(loop.items.some((i) => i.status === 'due')).toBe(true)
  })

  it("draws a read's items as rows when the words ask for its list", async () => {
    const loop = await ask(cases[4]!)
    const list = loop.body.find((b) => b.t === 'list')
    expect(list?.t === 'list' && list.rows.length).toBeGreaterThan(0)
    const counts = runsOf(loop.body).filter((r) => r.t === 'count')
    expect(counts.length).toBe(2)
    expect(counts[1]?.t === 'count' && counts[1].of).toMatch(/context items/)
    expect(loop.text).toMatch(/^- /m)
  })

  it("draws the model's short list as a list, each line with its own citation", async () => {
    const loop = await ask(cases[5]!)
    const ul = loop.body.find((b) => b.t === 'ul')
    expect(ul?.t === 'ul' && ul.items.length).toBeGreaterThanOrEqual(2)
    if (ul?.t === 'ul')
      for (const line of ul.items) expect(line.some((r) => r.t === 'cite')).toBe(true)
  })

  it('answers what needs the person as an overview of their Inbox: groups, counts and rows by code', async () => {
    const loop = await ask(cases[6]!)
    const o = loop.overview!
    expect(o.from).toBe('inbox')
    expect(o.total).toBe(o.groups.reduce((n, g) => n + g.count, 0))
    expect(o.groups.length).toBeGreaterThan(2)
    for (const g of o.groups) expect(g.rows.length + g.more).toBe(g.count)
    expect(loop.state).toBeNull()
    // A row about an item the person may read cites it.
    const items = new Set(o.groups.flatMap((g) => g.rows.flatMap((r) => r.item ?? [])))
    expect(items.size).toBe(loop.sources.length)
  })

  it('answers what is out of date as an overview of the records, by domain', async () => {
    const loop = await ask(cases[7]!)
    const o = loop.overview!
    expect(o.from).toBe('records')
    expect(o.by).toBe('domain')
    expect(o.total).toBe(o.groups.reduce((n, g) => n + g.count, 0))
    // Each row says why it is due, and its day is the one that says it.
    for (const row of o.groups.flatMap((g) => g.rows))
      expect(row.status).toMatch(/^its (check date passed|definition changed|source is missing)$/)
    expect(loop.footer.denominator).toBeNull()
  })

  it('answers how a domain stands as an overview of its records, what needs a check first', async () => {
    const loop = await ask(cases[8]!)
    const o = loop.overview!
    expect(o.by).toBe('status')
    expect(o.groups[0]?.key).toBe('due')
  })

  it('asks one question back with its choices and no state', async () => {
    const loop = await ask(cases[9]!)
    expect(loop.kind).toBe('question')
    expect(loop.state).toBeNull()
    expect(loop.choices).toEqual(['In France', 'In Spain'])
  })

  it('says on the read line how the dates were read when the words left room', async () => {
    const loop = await ask(cases[10]!)
    expect(loop.subject).toMatchObject({
      period: '1-30 Nov 2025',
      note: 'year not given',
      assumedToday: false,
    })
    // Dates the words named in full need no note.
    expect(turns['loop-checked']!.loop!.subject?.note).toBeNull()
  })

  it('reads "since" an event the reader cannot place from the day the event started', async () => {
    const loop = await ask(cases[11]!)
    // The customs rule is no date, but the event it names started on 4 August 2026: from then to today.
    expect(loop.subject).toMatchObject({
      period: '4 Aug to 23 Oct 2026',
      note: 'from “Online sales to Norway stopped”, 4 Aug 2026',
      assumedToday: false,
    })
    expect(loop.state).not.toBe('missing')
  })

  it('draws an answer about what a metric is as its definition card, standing in for the words', async () => {
    const loop = await ask(cases[12]!)
    expect(loop.state).toBeNull()
    const [card] = loop.defined!.cards
    expect(card).toMatchObject({
      id: 'metric:net_revenue',
      name: 'Net revenue',
      kind: 'metric',
      tool: 'Cube',
      inWords: true,
    })
    expect(card!.words).toMatch(/^Gross sales after returns/)
    expect(card!.member).toBeTruthy()
    // Its domain is a chip a read named, with its owners by name.
    expect(loop.nouns.map((n) => n.id)).toContain(card!.domain!.id)
    expect(card!.owners.length).toBeGreaterThan(0)
    // Its context: the items the read of it returned, as the turn's rows, and how many in all.
    expect(card!.context.items.length).toBeGreaterThan(0)
    expect(card!.context.count).toBe(card!.context.items.length)
    for (const id of card!.context.items) expect(loop.items.map((i) => i.id)).toContain(id)
  })

  it('draws the definition card of a metric nothing is written about, with no context', async () => {
    const loop = await ask(cases.find((c) => c.id === 'loop-definition-unwritten')!)
    expect(loop.state).toBeNull()
    const [card] = loop.defined!.cards
    expect(card).toMatchObject({ id: 'metric:churn_rate', kind: 'metric', context: { count: 0 } })
    expect(card!.owners.length).toBeGreaterThan(0)
  })

  it('names the word its reads found nothing under, when nothing it read covers the question', async () => {
    const loop = await ask(cases[13]!)
    expect(loop.unknown).toEqual(['EBITDA'])
    expect(loop.state).toBeNull()
    expect(loop.sources).toEqual([])
  })

  it('draws an answer from the help in its Markdown: bold labels, a link, a numbered list and a table, no asterisks', async () => {
    const loop = await ask(cases.find((c) => c.id === 'loop-help-markdown')!)
    expect(loop.help?.map((h) => h.slug)).toContain('write-context')
    expect(loop.body.map((b) => b.t)).toEqual(['p', 'ul', 'ul', 'table'])
    const [lead, labels, steps] = loop.body
    expect(lead?.t === 'p' && lead.runs).toContainEqual({
      t: 'text',
      text: 'Write context',
      link: { slug: 'write-context', id: 'what-to-put-in-it' },
    })
    expect(labels?.t === 'ul' && labels.items.map((i) => i[0])).toEqual(
      ['Properties:', 'Applies to:', 'Source:'].map((text) => ({
        t: 'text',
        text,
        marks: ['bold'],
      })),
    )
    // An address no read gave is no link: the words in a read could have made it.
    expect(runsOf(loop.body)).toContainEqual({
      t: 'text',
      text: ' a link anyone can open, such as the customs notice.',
    })
    expect(steps?.t === 'ul' && steps.start).toBe(1)
    for (const r of runsOf(loop.body)) if (r.t === 'text') expect(r.text).not.toMatch(/\*\*|~~|\|/)
    expect(loop.text).not.toMatch(/\*\*|~~/)
  })

  it('offers the action a help answer marks, from the part that explains it, with no state', async () => {
    const write = await ask(cases.find((c) => c.id === 'loop-help-write')!)
    expect(write).toMatchObject({ state: null, actions: [{ id: 'write_context' }] })
    expect(write.help?.map((h) => `${h.slug}#${h.id}`)).toContain(
      'write-context#add-a-context-item',
    )
    expect(write.text).not.toMatch(/do:/)
    const invite = await ask(cases.find((c) => c.id === 'loop-help-invite')!)
    expect(invite.actions).toEqual([{ id: 'invite_people' }])
    expect(invite.help?.map((h) => `${h.slug}#${h.id}`)).toContain('domains-and-owners#people')
  })

  it('says Stopped at its step limit with no state, over the plain read', async () => {
    const loop = await ask(cases.find((c) => c.id === 'loop-stopped')!)
    expect(loop).toMatchObject({ kind: 'stopped', stopped: 'steps', state: null })
    expect(loop.text).toMatch(/^Ask stopped at its limit of \d+ steps/)
  })

  it('writes the examples the mock shows, when asked to', () => {
    const out = process.env.LOOP_SHAPES_OUT
    if (!out) return
    const examples = Object.fromEntries(
      Object.entries(turns).map(([id, a]) => [
        id,
        { question: a.question, turn: a.loop as LoopTurn },
      ]),
    )
    writeFileSync(out, `${JSON.stringify(examples, null, 2)}\n`)
  })
})
