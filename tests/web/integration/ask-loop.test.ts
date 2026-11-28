import { describe, expect, it } from 'vitest'
import { chatTurnOf, type Answer } from '@/model/ask'
import { UNCHECKED } from '../../../src/server/modules/answer/loop-check.ts'
import {
  scriptedLoopChoice,
  scriptedLoopModel,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../../src/server/modules/answer/index.ts'
import { tableContents, transaction } from '../../integration/support.ts'
import { askWorld } from './ask-world.ts'

/*
  Ask's loop on the demo week (FR-718 to FR-720), through the real service, the browser's own
  binding and row security, as each person: the scripted reader the service runs on the mock, or
  a model a test scripts for one turn. What an earlier turn read is read again as the person before
  it is used (FR-718.3), a chat changes nothing (FR-718.4), and its words are kept nowhere
  (FR-719.4).
*/

const ML = 'Maria Lindqvist'
const AUDIENCE_ITEM = 'itm_norwaystop'

/** The model of the next turn: the scripted reader, unless a test scripts one. */
let decide: ((prompt: ScriptedPrompt) => ScriptedStep) | null = null
const reader = scriptedLoopModel()
const scripted = scriptedLoopChoice('test', (prompt) => decide!(prompt))
const world = askWorld({
  askTrace: {
    get loopModel() {
      return decide ? scripted : reader
    },
  },
})

const turnOf = (a: Answer) => {
  const turn = chatTurnOf(a)
  if (!turn) throw new Error('No turn to send back.')
  return turn
}

/** Sets the item's audience: only a group nobody is in reads it, or everyone again (null). */
const audience = (groups: string[] | null) =>
  transaction(world.client, async () => {
    await world.client.query('alter table item_versions disable trigger user')
    await world.client.query('update item_versions set audience_groups = $2 where item_id = $1', [
      AUDIENCE_ITEM,
      groups,
    ])
    await world.client.query('alter table item_versions enable trigger user')
  })

describe("Ask's loop", () => {
  it('answers what applies with its sources by number, its state and what it read', async () => {
    const api = await world.as(ML)
    const a = await api.ask({ question: 'orders in Norway' })
    expect(a.sources).toContain(AUDIENCE_ITEM)
    expect(a.text).toMatch(/\[1\]/)
    expect(a.state).toBe('conflict')
    expect(a.read?.[0]).toMatch(/^Looked up Orders and Norway, /)
    // What applies, out of what the person may read, said once by code.
    expect(a.footer?.denominator).toBe('3 of 21 published context items you can see apply.')
    expect(a.reads?.map((r) => r.tool)).toEqual(['get_context', 'find_context'])
  })

  it('says Not found when nothing is written, and lists what is nearby without using it', async () => {
    const api = await world.as(ML)
    const a = await api.ask({ question: 'Give me all about orders in poland' })
    expect(a.state).toBe('missing')
    expect(a.metric).toBe('Orders')
    expect(a.values).toEqual(['Poland'])
    expect(a.sources).toEqual([])
    expect(a.related?.length).toBeGreaterThan(0)
    expect(a.text).toContain('Nothing written covers Orders and Poland.')
  })

  it("reads an earlier turn's reads again: an item hidden since is neither given, named nor cited", async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway' })
    expect(first.sources).toContain(AUDIENCE_ITEM)
    const { rows } = await world.client.query<{ title: string }>(
      'select title from item_versions where item_id = $1 order by version_no desc limit 1',
      [AUDIENCE_ITEM],
    )
    const title = rows[0]!.title
    await audience(['finance_team'])
    try {
      let seen = ''
      // A model that cites the item it saw last turn, by its id, whatever it is given now. Only
      // the first prompt: the rewrite after the answer check quotes the failing sentence.
      decide = ({ prompt }) => {
        seen ||= JSON.stringify(prompt)
        return { text: `As before [${AUDIENCE_ITEM}].` }
      }
      const again = await api.ask({ question: 'are you sure?', turns: [turnOf(first)] })
      expect(seen).not.toContain(AUDIENCE_ITEM)
      expect(seen).not.toContain(title)
      expect(again.sources).not.toContain(AUDIENCE_ITEM)
      // Nowhere in the turn, the check's own record of what failed included.
      expect(JSON.stringify(again)).not.toContain(AUDIENCE_ITEM)
      expect(again.text).toBe(UNCHECKED)
      expect(JSON.stringify(again)).not.toContain(title)
    } finally {
      decide = null
      await audience(null)
    }
  })

  it('takes no result from the browser: a turn sent with one is refused', async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway' })
    const edited = {
      ...turnOf(first),
      reads: [{ tool: 'get_context', input: { about: 'orders in Norway' }, result: { ids: [] } }],
    }
    await expect(api.ask({ question: 'are you sure?', turns: [edited as never] })).rejects.toThrow()
  })

  it('cites no item an edited earlier reply points at, when no read returns it now', async () => {
    const api = await world.as(ML)
    let seen = ''
    decide = ({ prompt }) => {
      seen ||= JSON.stringify(prompt)
      return { text: 'As before [itm_giftcardonly].' }
    }
    try {
      const a = await api.ask({
        question: 'and what else?',
        turns: [
          {
            question: 'orders in Norway',
            sources: ['itm_giftcardonly'],
            reply: 'Here is what is written. Norway counts card and cash only [1].',
            // No read returns the item: the browser's word for it is no source.
            reads: [{ tool: 'find_context', input: { words: 'Poland' } }],
          },
        ],
      })
      // The sentence that cites it is not said again; the rest of the reply is.
      expect(seen).toContain('Here is what is written.')
      expect(seen).not.toContain('card and cash only')
      expect(a.sources).toEqual([])
      // The cited item is no read of this chat: the sentence fails twice and is replaced.
      expect(a.text).toBe(UNCHECKED)
    } finally {
      decide = null
    }
  })

  it('carries the subject the answer used, never the oldest read of the chat', async () => {
    const api = await world.as(ML)
    /** A turn that reads `about`, then cites the first item it found, if any. */
    const reading = (about: string) => {
      decide = ({ results, step }) =>
        step === 0
          ? { calls: [{ toolName: 'get_context', input: { about } }] }
          : { text: `As written [${itemsOf(results[0]!.value)[0]?.id ?? 'itm_none0000'}].` }
    }
    try {
      reading('net revenue')
      const first = await api.ask({ question: 'what is net revenue' })
      reading('orders in Norway')
      const second = await api.ask({
        question: 'why did orders drop in Norway',
        turns: [turnOf(first)],
      })
      const cited = second.sources?.[0]
      expect(cited).toBeDefined()
      // A turn that reads nothing and cites what the second turn's read found.
      decide = () => ({ text: `Because of what is written [${cited}].` })
      const third = await api.ask({
        question: 'are you sure?',
        turns: [turnOf(first), turnOf(second)],
      })
      expect(third.sources).toEqual([cited])
      expect(third.loop?.subject).toMatchObject({ names: ['Orders', 'Norway'], carried: true })
    } finally {
      decide = null
    }
  })

  // The release judge's A3 (L6): the model's own reads of "Who owns Sales?", and words that name
  // the Sales domain and its owners from what the last read returned.
  it('does not read "Who owns Sales?" as the metric its read of Sales found', async () => {
    const api = await world.as(ML)
    decide = ({ results, step }) => {
      if (step === 0)
        return {
          calls: [
            { toolName: 'get_context', input: { about: 'Sales domain owners', no_period: true } },
            { toolName: 'definitions', input: { domain: 'Sales', limit: 5 } },
            { toolName: 'get_context', input: { about: 'Sales', no_period: true } },
          ],
        }
      const { owners } = results.at(-1)!.value as { owners: { id: string; people: string[] }[] }
      const sales = owners.find((o) => o.id === 'domain:area_sales')!
      const people = sales.people.map((p) => `[@${p}]`).join(' and ')
      return { text: `The [@domain:area_sales] domain is owned by ${people}.` }
    }
    try {
      const a = await api.ask({ question: 'Who owns Sales?' })
      // The model's read of "Sales" is read as a metric and finds items; the answer is not about it.
      expect(a.read?.at(-1)).toMatch(
        /^Looked up (Net revenue|Gross sales), .*: [1-9]\d* items? appl/,
      )
      expect(a.text).toMatch(/^The Sales domain is owned by \S+ \S+ and \S+ \S+\.$/)
      expect(a.loop?.subject).toBeNull()
      expect(a.state).toBeNull()
      expect(a.loop?.defined).toBeUndefined()
      expect(a.footer?.denominator).toBe(
        'None of the 21 published context items you can see is cited.',
      )
    } finally {
      decide = null
    }
  })

  // The release judge's F1.5: a reply that reads nothing new, about the first turn's item, after
  // a turn about another market whose answer line is another.
  it('carries the answer line of the read it cites, not of the turn before', async () => {
    const api = await world.as(ML)
    const reading = (about: string) => {
      decide = ({ results, step }) =>
        step === 0
          ? { calls: [{ toolName: 'get_context', input: { about } }] }
          : { text: `As written [${itemsOf(results[0]!.value)[0]?.id ?? 'itm_none0000'}].` }
    }
    try {
      reading('orders in Germany')
      const first = await api.ask({ question: 'what is written about orders in Germany?' })
      reading('orders in Norway')
      const second = await api.ask({ question: 'and in Norway?', turns: [turnOf(first)] })
      expect([first.state, second.state]).toEqual(['grounded', 'conflict'])
      const cited = first.sources[0]
      // Reads nothing new, and cites what the first turn's read found.
      decide = () => ({ text: `No, what is written says otherwise [${cited}].` })
      const third = await api.ask({
        question: 'so can I say the Germany rule still holds?',
        turns: [turnOf(first), turnOf(second)],
      })
      expect(third.sources).toEqual([cited])
      expect(third.state).toBe('grounded')
      expect(third.loop?.subject).toMatchObject({ names: ['Orders', 'Germany'], carried: true })
    } finally {
      decide = null
    }
  })

  // The release judge's three questions that ended with nothing shown (A1): each needed more
  // reads than its limit let it make.
  it.each([
    'What is our GMV definition?',
    'How is CPA counted for paid search?',
    'How were orders in Norway in October 2023?',
  ])('shows the plain read under one sentence when the model stops: %s', async (question) => {
    const api = await world.as(ML)
    // A model that keeps reading until its step limit stops it.
    decide = () => ({ calls: [{ toolName: 'find_context', input: { words: question } }] })
    try {
      const a = await api.ask({ question })
      expect(a.stopped).toBe('steps')
      expect(a.text).toMatch(/so this is what is written, as agents get it\.$/)
      // A stop is a stop: it shows "Stopped" and no state.
      expect(a.state).toBeNull()
      expect(a.loop?.body.length).toBeGreaterThan(0)
    } finally {
      decide = null
    }
  })

  it('changes nothing and keeps none of a chat’s words, in any table', async () => {
    const api = await world.as(ML)
    // The first question of a session marks Ask as used for the setup checklist; after it, nothing.
    await api.ask({ question: 'orders in Norway' })
    const marker = 'Quillfeather'
    const before = await tableContents(world.client)
    const first = await api.ask({ question: `orders in Norway after the ${marker} audit` })
    await api.ask({ question: `and the ${marker} review?`, turns: [turnOf(first)] })
    const after = await tableContents(world.client)
    expect(after).toEqual(before)
    expect(after.join('\n')).not.toContain(marker)
  })
})

describe("Ask's scripted reader, which answers the demo with no model (MODELS=mock)", () => {
  it('gives the definition, first and alone, when asked what a metric is', async () => {
    const api = await world.as(ML)
    const a = await api.ask({ question: 'What is net revenue?' })
    expect(a.text).toMatch(/^Net revenue means: \S/)
    expect(a.loop?.defined?.names).toEqual(['Net revenue'])
    expect(a.state).toBeNull()
    expect(a.sources).toEqual([])
  })

  it('cites the two items that disagree first under Conflict, so the page shows them', async () => {
    const api = await world.as(ML)
    const a = await api.ask({ question: 'orders in Norway' })
    expect(a.state).toBe('conflict')
    expect(a.loop?.conflict).toHaveLength(2)
    expect(a.sources?.slice(0, 2).toSorted()).toEqual(a.loop!.conflict.toSorted())
  })

  it('reads a follow-up that names nothing with the question before it', async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway' })
    const next = await api.ask({
      question: 'And who decides which one is right?',
      turns: [turnOf(first)],
    })
    expect(next.reads?.map((r) => r.tool)).toEqual(['get_context', 'find_context', 'get_context'])
    expect(next.reads?.[2]?.input).toEqual({
      about: 'orders in Norway And who decides which one is right?',
    })
    expect(next.state).toBe('conflict')
    expect(next.loop?.subject?.names).toEqual(['Orders', 'Norway'])
    expect(next.loop?.conflict).toEqual(first.loop?.conflict)
  })

  it('reads a new question in the same chat on its own', async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway' })
    const next = await api.ask({
      question: 'What is the weather in Oslo today?',
      turns: [turnOf(first)],
    })
    expect(next.reads?.map((r) => r.tool)).toEqual(['get_context', 'find_context'])
    expect(next.state).toBe('missing')
  })
})

/** The ids of the items a read returned, in its order, and how each matched a search. */
const itemsOf = (value: unknown) =>
  ((value as { items?: { id: string; title: string; match?: string }[] }).items ?? []).map(
    ({ id, title, match }) => ({ id, title, match }),
  )

describe("Ask's loop on the rules' gaps (the retrieval test, 2026-11-10)", () => {
  /** A model that reads with `calls`, then answers in the words `text` writes from the reads. */
  const asked = async (
    question: string,
    calls: { toolName: string; input: Record<string, unknown> }[],
    text: (results: ScriptedPrompt['results']) => string,
  ) => {
    const api = await world.as(ML)
    decide = ({ results, step }) => (step === 0 ? { calls } : { text: text(results) })
    try {
      return await api.ask({ question })
    } finally {
      decide = null
    }
  }

  it('reads a value it does not know as unread, and keeps the item the words cite as theirs', async () => {
    const a = await asked(
      'anything written about orders in Jordan?',
      [
        { toolName: 'get_context', input: { about: 'orders in Jordan' } },
        { toolName: 'find_context', input: { words: 'orders Jordan' } },
      ],
      // The search matches only "orders": the model cites an item about another market anyway.
      (results) => `Orders has items [${itemsOf(results[1]!.value)[0]!.id}].`,
    )
    // The words rest on a written item, though not about Jordan: their source, and not Not found.
    expect(a.state).toBe('partial')
    expect(a.sources).toHaveLength(1)
    expect(a.read?.[0]).toBe(
      "Looked up “orders in Jordan”: nothing applies. There is no value of Market named 'Jordan'.",
    )
    // As the mock's own reader asks it too: never Orders in every market.
    const plain = await (
      await world.as(ML)
    ).ask({ question: 'anything written about orders in Jordan?' })
    expect(plain.state).not.toBe('conflict')
    expect(plain.sources).toEqual([])
  })

  it('keeps what a search found by every word, beside the items the subject read gives', async () => {
    let found: { id: string; match?: string }[] = []
    const a = await asked(
      'should we bring the norway campaigns back?',
      [
        { toolName: 'get_context', input: { about: 'norway campaigns' } },
        { toolName: 'find_context', input: { words: 'Norway campaigns' } },
      ],
      (results) => {
        found = itemsOf(results[1]!.value)
          .filter((i) => i.match === 'all')
          .slice(0, 2)
        return `What is written is about the Norway campaigns [${found[0]!.id}] [${found[1]!.id}].`
      },
    )
    expect(found).toHaveLength(2)
    expect(a.state).not.toBe('missing')
    expect(a.sources).toEqual(found.map((i) => i.id))
    expect(a.text).toContain('campaigns.[1] [2]')
    // A market with no metric reads every item about it, so the count says what applies.
    expect(a.footer?.denominator).toBe('6 of 21 published context items you can see apply.')
  })

  it('under Not found, leaves out the words that only listed what it cited', async () => {
    const a = await asked(
      'Give me all about orders in poland',
      [{ toolName: 'get_context', input: { about: 'orders in poland' } }],
      (results) => {
        const near = (results[0]!.value as { nearby: { id: string }[] }).nearby.map((n) => n.id)
        return `Nothing written covers orders in Poland. Other markets each have their own items, such as [${near[0]}], [${near[1]}] and [${near[2] ?? near[0]}].`
      },
    )
    expect(a.state).toBe('missing')
    expect(a.sources).toEqual([])
    expect(a.text).toBe(
      'Nothing written covers orders in Poland. Other markets each have their own items.',
    )
  })

  it('says a word it read only by a synonym written in Definitions', async () => {
    const a = await asked(
      'when do you reckon online sales to norway will come back',
      [{ toolName: 'get_context', input: { about: 'online sales to norway' } }],
      () => 'Nothing written covers it.',
    )
    expect(a.read?.[0]).toMatch(
      /^Looked up Net revenue and Norway, .*\. “Sales” was read as Net revenue, by a synonym written in Definitions\.$/,
    )
  })

  it('reads "discounts" as Discount cost', async () => {
    let found: { id: string; title: string }[] = []
    const a = await asked(
      'anything on norway discounts from last winter?',
      [{ toolName: 'get_context', input: { about: 'norway discounts from last winter' } }],
      (results) => {
        found = itemsOf(results[0]!.value)
        return `A VAT rule applied [${found[0]?.id ?? 'itm_none0000'}].`
      },
    )
    expect(a.read?.[0]).toMatch(/^Looked up Discount cost and Norway, /)
    expect(found.map((i) => i.title)).toContain('New VAT rate applied in Norway from 3 August 2025')
    expect(a.sources).toEqual([found[0]!.id])
  })
})

describe("Ask's loop on a question that names no dates", () => {
  /** A model that reads with `calls`, then answers in the words `text` writes from the reads. */
  const asked = async (
    question: string,
    calls: { toolName: string; input: Record<string, unknown> }[],
    text: (results: ScriptedPrompt['results']) => string,
  ) => {
    const api = await world.as(ML)
    decide = ({ results, step }) => (step === 0 ? { calls } : { text: text(results) })
    try {
      return await api.ask({ question })
    } finally {
      decide = null
    }
  }
  /** Reads the subject at no dates, and answers citing every item the read gave. */
  const citingAll = async (question: string, about: string) => {
    let cited: string[] = []
    const a = await asked(question, [{ toolName: 'get_context', input: { about } }], (results) => {
      cited = itemsOf(results[0]!.value).map((i) => i.id)
      return `This is what is written ${cited.map((id) => `[${id}]`).join(' ')}.`
    })
    expect(cited.length).toBeGreaterThan(0)
    expect(a.sources).toEqual(cited)
    // The read line still says the date was assumed.
    expect(a.loop?.subject?.assumedToday).toBe(true)
    return a
  }

  it('gives a definition its label and no state', async () => {
    const a = await asked(
      'what is net revenue',
      [
        { toolName: 'definitions', input: { names: ['Net revenue'] } },
        { toolName: 'get_context', input: { about: 'net revenue' } },
      ],
      (results) => {
        const found = results[0]!.value as { definitions: { words: string | null }[] }
        return found.definitions[0]!.words!
      },
    )
    expect(a.loop?.subject?.assumedToday).toBe(true)
    expect(a.loop?.defined?.names).toEqual(['Net revenue'])
    expect(a.state).toBeNull()
  })

  it('takes the state from what the items cover, never from today assumed', async () => {
    expect(
      (await citingAll('does net revenue in Spain include VAT', 'net revenue in Spain')).state,
    ).toBe('grounded')
    expect((await citingAll('what applies to orders in Germany', 'orders in Germany')).state).toBe(
      'grounded',
    )
  })

  it('stays Partial when the items cover only part of the question', async () => {
    expect((await citingAll('what is net revenue', 'net revenue')).state).toBe('partial')
    expect(
      (await citingAll('net revenue in Spain and Poland', 'net revenue in Spain and Poland')).state,
    ).toBe('partial')
  })
})

describe("Ask's loop on the days the model read a period as", () => {
  /** A model that reads the subject with these days and words, then answers citing nothing. */
  const read = async (
    question: string,
    input: Record<string, unknown>,
    turns: Parameters<Awaited<ReturnType<typeof world.as>>['ask']>[0]['turns'] = [],
  ) => {
    const api = await world.as(ML)
    decide = ({ step }) =>
      step === 0
        ? { calls: [{ toolName: 'get_context', input: { about: 'net revenue', ...input } }] }
        : { text: 'Nothing more is written.' }
    try {
      return await api.ask({ question, turns })
    } finally {
      decide = null
    }
  }

  it('says the other reading when the model’s days and the reader’s differ: "and in Q3?" after "last year"', async () => {
    const first = await read("what was net revenue's definition last year", {
      period_words: 'last year',
      from: '2025-01-01',
      to: '2025-12-31',
    })
    expect(first.loop?.subject).toMatchObject({ period: '1 Jan to 31 Dec 2025', note: null })
    const q3 = await read(
      'and in Q3?',
      { period_words: 'Q3', from: '2025-07-01', to: '2025-09-30' },
      [turnOf(first)],
    )
    // The words name no year, so the model's, from the chat, stands, and the reader's is said.
    expect(q3.loop?.subject).toMatchObject({
      period: '1 Jul to 30 Sep 2025',
      note: 'could also mean 1 Jul to 30 Sep 2026',
    })
  })

  it('keeps the reader’s days where it placed the words, and says the model’s beside them', async () => {
    const a = await read('net revenue last quarter', {
      period_words: 'last quarter',
      from: '2026-04-01',
      to: '2026-06-30',
    })
    expect(a.loop?.subject).toMatchObject({
      period: '1 Jul to 30 Sep 2026',
      note: 'could also mean 1 Apr to 30 Jun 2026',
    })
  })

  it('takes the reader’s own words for the days when both agree', async () => {
    const a = await read('net revenue last quarter', {
      period_words: 'last quarter',
      from: '2026-07-01',
      to: '2026-09-30',
    })
    expect(a.loop?.subject).toMatchObject({ period: '1 Jul to 30 Sep 2026', note: null })
  })

  it('takes the model’s days where the reader places no words', async () => {
    const a = await read('net revenue in the month before last', {
      period_words: 'the month before last',
      from: '2026-08-01',
      to: '2026-08-31',
    })
    expect(a.loop?.subject).toMatchObject({ period: '1-31 Aug 2026', note: null })
  })

  it('takes the reader’s days where the model gives none', async () => {
    const a = await read('net revenue last year', { period_words: 'last year' })
    expect(a.loop?.subject).toMatchObject({ period: '1 Jan to 31 Dec 2025', note: null })
  })
})

describe("Ask's loop on a follow-up that changes only the period", () => {
  /** A model that reads Orders in Norway with this period, then answers citing nothing. */
  const read = async (
    question: string,
    input: Record<string, unknown>,
    turns: Parameters<Awaited<ReturnType<typeof world.as>>['ask']>[0]['turns'] = [],
  ) => {
    const api = await world.as(ML)
    decide = ({ step }) =>
      step === 0
        ? { calls: [{ toolName: 'get_context', input: { about: 'orders in Norway', ...input } }] }
        : { text: 'Nothing more is written.' }
    try {
      return await api.ask({ question, turns })
    } finally {
      decide = null
    }
  }

  it('reads a bare month and a delta against the last question’s period, and says so', async () => {
    const august = await read('why did orders drop in Norway in August 2026', {
      period_words: 'August 2026',
    })
    expect(august.loop?.subject).toMatchObject({ period: '1-31 Aug 2026', note: null })
    const september = await read(
      'what about September?',
      { period_words: 'September', relative_to: 'last question' },
      [turnOf(august)],
    )
    expect(september.loop?.subject).toMatchObject({
      period: '1-30 Sep 2026',
      note: 'from your last question',
    })
    const lastYear = await read(
      'and last year?',
      { period_words: 'last year', relative_to: 'last question' },
      [turnOf(august), turnOf(september)],
    )
    // A year before the last question's September, not the whole of last year.
    expect(lastYear.loop?.subject).toMatchObject({
      period: '1-30 Sep 2025',
      note: 'from your last question',
    })
  })
})

describe("Ask's loop on a follow-up that keeps the period", () => {
  it('reads the same period for another market, and says it is the last question’s', async () => {
    const api = await world.as(ML)
    const step =
      (input: Record<string, unknown>) =>
      ({ step }: ScriptedPrompt): ScriptedStep =>
        step === 0
          ? { calls: [{ toolName: 'get_context', input }] }
          : { text: 'Nothing more is written.' }
    try {
      decide = step({ about: 'orders in Norway in August 2026', period_words: 'August 2026' })
      const august = await api.ask({ question: 'orders in Norway in August 2026' })
      decide = step({ about: 'orders in Sweden', relative_to: 'last question' })
      const sweden = await api.ask({ question: 'and in Sweden?', turns: [turnOf(august)] })
      expect(sweden.loop?.subject).toMatchObject({
        period: '1-31 Aug 2026',
        note: 'from your last question',
      })
      // Without the mark, a follow-up's own words are read as they stand: today, assumed.
      decide = step({ about: 'orders in Sweden' })
      const alone = await api.ask({ question: 'and in Sweden?', turns: [turnOf(august)] })
      expect(alone.loop?.subject).toMatchObject({ assumedToday: true })
    } finally {
      decide = null
    }
  })
})

describe("Ask's loop on a period the person chose on the read line", () => {
  /** A model that reads the subject with these words, then answers citing nothing. */
  const reading =
    (input: Record<string, unknown>) =>
    ({ step }: ScriptedPrompt): ScriptedStep =>
      step === 0
        ? { calls: [{ toolName: 'get_context', input }] }
        : { text: 'Nothing more is written.' }

  it('reads a question that named no dates at the period chosen, never assumed', async () => {
    const api = await world.as(ML)
    const assumed = await api.ask({ question: 'orders in Norway' })
    expect(assumed.loop?.subject).toMatchObject({ assumedToday: true })
    const any = await api.ask({ question: 'orders in Norway', period: 'any date' })
    expect(any.loop?.subject).toMatchObject({ period: 'any date', assumedToday: false })
    const quarter = await api.ask({ question: 'orders in Norway', period: 'last quarter' })
    expect(quarter.loop?.subject).toMatchObject({
      period: '1 Jul to 30 Sep 2026',
      assumedToday: false,
      note: null,
    })
  })

  it("stands over the words' own dates and the model's days", async () => {
    const api = await world.as(ML)
    decide = reading({
      about: 'orders in Norway in August 2026',
      period_words: 'August 2026',
      from: '2026-08-01',
      to: '2026-08-31',
    })
    try {
      const picked = await api.ask({
        question: 'orders in Norway in August 2026',
        period: { from: '2026-10-05', to: '2026-10-11' },
      })
      expect(picked.loop?.subject).toMatchObject({ period: '5-11 Oct 2026', note: null })
      const any = await api.ask({ question: 'orders in Norway in August 2026', period: 'any date' })
      expect(any.loop?.subject).toMatchObject({ period: 'any date' })
    } finally {
      decide = null
    }
  })

  it('is read again with the chat, and never shown to the model as its own input', async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway', period: 'any date' })
    const sent = turnOf(first)
    expect(sent.reads?.find((r) => r.tool === 'get_context')?.input).toMatchObject({
      period: 'any date',
    })
    let calls: unknown[] = []
    let results: unknown[] = []
    decide = ({ prompt }) => {
      const parts = prompt.flatMap(
        (m): { type: string; input?: unknown; output?: { type: string; value?: unknown } }[] =>
          Array.isArray(m.content) ? m.content : [],
      )
      calls = parts.flatMap((c) => (c.type === 'tool-call' ? [c.input] : []))
      results = parts.flatMap((c) =>
        c.type === 'tool-result' && c.output?.type === 'json' ? [c.output.value] : [],
      )
      return { text: 'Nothing more is written.' }
    }
    try {
      await api.ask({ question: 'and what applies?', turns: [sent] })
    } finally {
      decide = null
    }
    // The earlier get_context, made again at the period chosen; its input as the model wrote it.
    expect(results[0]).toMatchObject({ read: { period: 'any date' } })
    expect(calls[0]).toEqual({ about: 'orders in Norway' })
    for (const input of calls) expect(input).not.toHaveProperty('period')
  })

  it('names the period chosen in the first sentence, by code, when the words do not', async () => {
    const api = await world.as(ML)
    const month = await api.ask({ question: 'orders in Norway', period: 'last month' })
    expect(month.loop?.subject).toMatchObject({ period: '1-30 Sep 2026', assumedToday: false })
    expect(month.text).toMatch(/^This answer is for last month, September 2026\. \S/)
    // The sentence is the first of the words' first paragraph, before the model's own.
    const [first] = month.loop!.body
    expect(first?.t === 'p' && first.runs[0]).toEqual({
      t: 'text',
      text: 'This answer is for last month, September 2026. ',
    })
    const any = await api.ask({ question: 'orders in Norway', period: 'any date' })
    expect(any.text).toMatch(/^This answer is for any date\. \S/)
    const picked = await api.ask({
      question: 'orders in Norway',
      period: { from: '2026-10-05', to: '2026-10-11' },
    })
    expect(picked.text).toMatch(/^This answer is for 5 to 11 October 2026\. \S/)
    // Asked with no period, it is read as it always was.
    const plain = await api.ask({ question: 'orders in Norway' })
    expect(plain.text).not.toMatch(/^This answer is for/)
  })

  it('reads the question asked again with the chat at the period chosen, though the model reads nothing', async () => {
    const api = await world.as(ML)
    decide = reading({ about: 'orders in Norway', no_period: true })
    let first: Answer
    try {
      first = await api.ask({ question: 'orders in Norway' })
    } finally {
      decide = null
    }
    expect(first.loop?.subject).toMatchObject({ period: 'any date' })
    // As a live model did: the same words asked again, answered from the chat's reads.
    decide = () => ({ text: 'Nothing more is written.' })
    try {
      const again = await api.ask({
        question: 'orders in Norway',
        turns: [turnOf(first)],
        period: 'last month',
      })
      expect(again.loop?.subject).toMatchObject({ period: '1-30 Sep 2026', carried: false })
      expect(again.text).toBe(
        'This answer is for last month, September 2026. Nothing more is written.',
      )
      // The read made at the period, with the earlier turn's words, as the model wrote them.
      expect(again.reads?.[0]).toEqual({
        tool: 'get_context',
        step: 0,
        input: { about: 'orders in Norway', no_period: true, period: 'last month' },
      })
    } finally {
      decide = null
    }
  })

  it("keeps the model's first sentence when it names the period or its days", async () => {
    const api = await world.as(ML)
    for (const text of [
      'For last month, nothing more is written.',
      'In September 2026, nothing more is written.',
    ]) {
      decide = ({ step }) =>
        step === 0
          ? { calls: [{ toolName: 'get_context', input: { about: 'orders in Norway' } }] }
          : { text }
      try {
        const a = await api.ask({ question: 'orders in Norway', period: 'last month' })
        expect(a.text).toBe(text)
      } finally {
        decide = null
      }
    }
  })

  it('refuses days that end before they start', async () => {
    const api = await world.as(ML)
    await expect(
      api.ask({ question: 'orders in Norway', period: { from: '2026-10-11', to: '2026-10-05' } }),
    ).rejects.toThrow()
  })
})

describe("Ask's loop on a period with two readings that find different items", () => {
  /**
   * A model that reads the subject with these words, then asks back with the read's choices of
   * period when it returns some, else answers citing nothing.
   */
  const read = async (input: Record<string, unknown>) => {
    const api = await world.as(ML)
    const seen: unknown[] = []
    decide = ({ step, results }) => {
      if (step === 0) return { calls: [{ toolName: 'get_context', input }] }
      const got = results.find((r) => r.toolName === 'get_context')?.value as {
        choices?: { period: string }[]
      }
      seen.push(got)
      return got?.choices?.length
        ? {
            calls: [
              {
                toolName: 'ask_back',
                input: {
                  question: 'Which August do you mean?',
                  choices: got.choices.map((c) => c.period),
                },
              },
            ],
          }
        : { text: 'Nothing more is written.' }
    }
    try {
      return { answer: await api.ask({ question: String(input.about) }), seen }
    } finally {
      decide = null
    }
  }

  it('asks back with both Augusts when only last year’s has items (R7)', async () => {
    // The Norway VAT rule applies from 3 August 2025 to 5 June 2026: nothing in August 2026.
    const { answer, seen } = await read({
      about: 'discount cost in Norway in August',
      period_words: 'August',
      from: '2026-08-01',
      to: '2026-08-31',
    })
    expect(seen[0]).toMatchObject({
      choices: [
        { period: '1-31 Aug 2025', from: '2025-08-01', to: '2025-08-31', found: 1 },
        { period: '1-31 Aug 2026', from: '2026-08-01', to: '2026-08-31', found: 0 },
      ],
    })
    expect(answer.loop?.kind).toBe('question')
    expect(answer.choices).toEqual(['1-31 Aug 2025', '1-31 Aug 2026'])
  })

  it('offers no choice where the words name the year', async () => {
    const { answer, seen } = await read({
      about: 'discount cost in Norway in August 2026',
      period_words: 'August 2026',
    })
    expect(seen[0]).not.toHaveProperty('choices')
    expect(answer.loop?.kind).toBe('answer')
  })
})
