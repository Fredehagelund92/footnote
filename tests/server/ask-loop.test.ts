import { describe, expect, it } from 'vitest'
import type { LookupEvent, LoopTurn } from '../../src/contract/answer.ts'
import type { Database } from '../../src/server/db/database.ts'
import {
  ASK_BACK,
  askLoop,
  loopSystem,
  readLines,
  scriptedLoopChoice,
  turnOf,
  type AskTools,
  type LoopDeps,
  type MadeRead,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../src/server/modules/answer/index.ts'

/*
  Ask's loop without a database (FR-718 to FR-720): what code writes from the reads (the citations
  checked against the ids the reads returned, the answer state, the footer and what was read), and
  the loop itself on a scripted model: its step and time limits, a model that fails, one question
  back, the chat's earlier reads made again, and one connection at a time. The loop on the real
  service is tests/web/integration/ask-loop.test.ts; the pool, ask-loop-pool.test.ts.
*/

const outOf = { count: 21, of: 'published context items you may read' }
const searched = (words: string, found: number) => ({
  words,
  names: [],
  period: 'any date',
  kinds: ['event', 'warning', 'rule', 'guide'],
  domain: null,
  without: null,
  found,
})
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Item ${id}`,
  summary: `What ${id} says.`,
  outOfDate: null,
  ...extra,
})
const get = (
  state: string,
  items: object[],
  nearby: string[] = [],
  ids = [...items.map((i) => (i as { id: string }).id), ...nearby],
): MadeRead => ({
  tool: 'get_context',
  input: { about: 'orders in Poland' },
  result: {
    state,
    read: { words: 'orders in Poland', names: ['Orders', 'Poland'], period: 'any date' },
    items,
    nearby: nearby.map((id) => ({ id, title: `Item ${id}`, kind: 'warning', why: 'other values' })),
    wider: null,
    searched: [searched('orders in Poland', items.length)],
    outOf,
    more: 0,
    ids,
  },
})
const find = (items: (object & { match: string })[], everyWord: number): MadeRead => ({
  tool: 'find_context',
  input: { words: 'payment provider' },
  result: {
    found: items.length,
    everyWord,
    items,
    definitions: [
      { id: 'metric:orders', name: 'Orders', words: 'Paid orders.', source: 'Cube (orders)' },
    ],
    searched: [searched('payment provider', everyWord)],
    outOf,
    more: 2,
    ids: [...items.map((i) => (i as unknown as { id: string }).id), 'metric:orders'],
  },
})
const records = (ids: string[]): MadeRead => ({
  tool: 'records',
  input: { about: ['Norway'] },
  result: {
    count: ids.length,
    outOf: { count: 23, of: 'context items you may read' },
    counted: `${ids.length} of 23 context items you may read`,
    items: ids.map((id) => item(id)),
    more: 0,
    ids,
  },
})

describe('what code writes from the reads', () => {
  it('numbers the citations a read returned, and drops the ones no read returned', () => {
    const t = turnOf(
      'Germany lags [itm_germany01]. Also [itm_unknown1, itm_france001]. And [metric:orders].',
      [
        find(
          [
            { ...item('itm_germany01'), match: 'all' },
            { ...item('itm_france001'), match: 'all' },
          ],
          2,
        ),
      ],
      [],
    )
    expect(t.text).toBe('Germany lags.[1] Also.[2] And.')
    expect(t.sources).toEqual(['itm_germany01', 'itm_france001'])
    // A definition's id is no source, and the question asks nothing a definition adds to.
    expect(t.definitions).toEqual([])
  })

  it('cites an id the words name bare, when a read returned it', () => {
    const t = turnOf(
      'The due item, itm_germany01, is past its date.',
      [find([{ ...item('itm_germany01'), match: 'all' }], 1)],
      [],
    )
    expect(t.text).toBe('The due item, [1], is past its date.')
    expect(t.sources).toEqual(['itm_germany01'])
  })

  it('takes the state from the read about the subject: Not found, its nearby items listed and not used', () => {
    // The subject read found nothing; the words cite only items it gave as nearby: they do not
    // apply, so they are no sources, and their numbers go.
    const t = turnOf(
      'Nothing is written about orders in Poland. Germany lags (by a day [itm_germany01]).',
      [get('missing', [], ['itm_germany01', 'itm_norway001'])],
      [],
    )
    expect(t.state).toBe('missing')
    expect(t.sources).toEqual([])
    expect(t.text).toBe('Nothing is written about orders in Poland. Germany lags (by a day).')
    expect(t.nearby).toEqual(['itm_germany01', 'itm_norway001'])
  })

  it('keeps the citations of what the reads returned, and a turn that cites one that is not nearby is not Not found', () => {
    // The subject read found nothing; the words cite an item it gave as nearby, and one a search
    // matched on some of its words only, which the words rest on.
    const t = turnOf(
      'Nothing is written about orders in Poland. Germany lags (by a day [itm_germany01]) and France switched [itm_france001].',
      [
        get('missing', [], ['itm_germany01', 'itm_norway001']),
        find([{ ...item('itm_france001'), match: 'some' }], 0),
      ],
      [],
    )
    expect(t.state).toBe('partial')
    expect(t.sources).toEqual(['itm_germany01', 'itm_france001'])
    expect(t.text).toBe(
      'Nothing is written about orders in Poland. Germany lags (by a day [1]) and France switched.[2]',
    )
    expect(t.closest).toBeNull()
  })

  it("keeps Not found when a turn cites an item an earlier turn's subject read gave as nearby", () => {
    const t = turnOf(
      'Still nothing about orders in Poland. Germany lags [itm_germany01].',
      [get('missing', [])],
      [get('missing', [], ['itm_germany01'])],
    )
    expect(t.state).toBe('missing')
    expect(t.sources).toEqual([])
  })

  it('takes what the cited items are when a search found what the subject read did not', () => {
    const t = turnOf(
      'France moved on 12 May [itm_france001] and on 21 May [itm_france002].',
      [
        get('missing', []),
        find(
          [
            { ...item('itm_france001'), match: 'all' },
            { ...item('itm_france002', { outOfDate: 'its check date has passed' }), match: 'all' },
          ],
          2,
        ),
      ],
      [],
    )
    expect(t.state).toBe('stale')
    expect(t.sources).toEqual(['itm_france001', 'itm_france002'])
    expect(t.footer.stale).toBe(
      '“Item itm_france002” may be out of date: its check date has passed.',
    )
  })

  it("takes the subject read's state when the words cite what it found", () => {
    const t = turnOf(
      'Two items disagree [itm_norway001] [itm_norway002].',
      [
        get('conflict', [
          item('itm_norway001', { disagreesWith: ['itm_norway002'] }),
          item('itm_norway002', { disagreesWith: ['itm_norway001'] }),
        ]),
      ],
      [],
    )
    expect(t.state).toBe('conflict')
    // The two that disagree, as the read marks them, for the page to name.
    expect(t.conflict).toEqual(['itm_norway001', 'itm_norway002'])
  })

  it('uses a search that matched some words when no read was about the subject', () => {
    const t = turnOf(
      'The switch [itm_france001].',
      [find([{ ...item('itm_france001'), match: 'some' }], 0)],
      [],
    )
    expect(t.state).toBe('grounded')
    expect(t.sources).toEqual(['itm_france001'])
  })

  it('gives an answer from the records no state, with its items as sources', () => {
    const made = [records(['itm_norway001', 'itm_norway002']), get('missing', [])]
    const listed = turnOf('Nine items [itm_norway001] [itm_norway002].', made, [])
    expect(listed.state).toBeNull()
    expect(listed.sources).toEqual(['itm_norway001', 'itm_norway002'])
    expect(turnOf('Nine items are about Norway.', made, []).state).toBeNull()
    expect(listed.footer.denominator).toBe('Counted 2 of 23 context items you may read.')
  })

  it('gives a turn that read nothing no state, and Not found after a search that found nothing', () => {
    expect(turnOf('I cannot answer that.', [], []).state).toBeNull()
    expect(turnOf('Nothing is written.', [find([], 0)], []).state).toBe('missing')
  })

  it('writes what was read and the footer from the reads, never from the words', () => {
    const made = [get('missing', [], ['itm_germany01']), find([], 0)]
    expect(readLines(made)).toEqual([
      'Looked up Orders and Poland, any date: 0 items apply, 1 nearby item does not.',
      'Searched “payment provider”, any date: 0 found.',
    ])
    const t = turnOf('Nothing.', made, [])
    expect(t.footer).toEqual({
      denominator: '0 of 21 published context items you may read apply.',
      notSeen: '2 more items were found and not listed.',
      stale: null,
    })
  })

  it('cites an id an earlier read returned, made again this turn', () => {
    const earlier = [find([{ ...item('itm_germany01'), match: 'all' }], 1)]
    const t = turnOf('As before, Germany lags [itm_germany01].', [], earlier)
    expect(t.sources).toEqual(['itm_germany01'])
    // Read nothing of its own: it is about the reads it cites, made again.
    expect(t.state).toBe('grounded')
    expect(turnOf('I cannot answer that.', [], earlier).state).toBeNull()
  })
})

describe('a turn that uses no context item', () => {
  const definitions = (words: string | null): MadeRead => ({
    tool: 'definitions',
    input: { names: ['Orders'] },
    result: {
      found: 1,
      definitions: [{ id: 'metric:orders', name: 'Orders', words, from: 'Cube (sales.orders)' }],
      names: [],
      ids: ['metric:orders'],
    },
  })
  const subject = (state: string, about = ['metric:orders']): MadeRead => {
    const read = get(state, [])
    const result = read.result as { read: object }
    return {
      ...read,
      result: {
        ...result,
        read: { ...result.read, about, assumedToday: true },
      },
    }
  }

  it('shows the Definition label, not a state, when it is about a definition', () => {
    const words =
      'The value of orders customers completed and paid for, in euros at the daily rate, with cancelled orders left out.'
    const t = turnOf(
      'Orders is the value of orders customers paid for.',
      [subject('partial'), definitions(words)],
      [],
      'What is orders?',
    )
    expect(t.state).toBeNull()
    expect(t.defined).toEqual({ names: ['Orders'], tool: 'Cube' })
    // The words give the definition, whatever the question's words.
    expect(
      turnOf(
        `Ordrer er ${words}`,
        [subject('partial'), definitions(words)],
        [],
        'Hva betyr ordrer?',
      ).defined,
    ).toEqual({ names: ['Orders'], tool: 'Cube' })
  })

  it('shows a definition the turn read whenever the words do not give it, in any language', () => {
    const words =
      'The value of orders customers completed and paid for, in euros at the daily rate, with cancelled orders left out.'
    // Asked in Norwegian, answered in Norwegian: the definition shows as its source words it.
    const asked = turnOf(
      'Ordrer er verdien av betalte ordrer.',
      [subject('partial'), definitions(words)],
      [],
      'Hva betyr ordrer?',
    )
    expect(asked.definitions).toEqual([
      { name: 'Orders', words, tool: 'Cube', id: 'metric:orders' },
    ])
    // Not asked what it is: still shown, since the turn read it and the words do not give it.
    expect(
      turnOf(
        'Nothing written covers why orders fell.',
        [subject('missing'), definitions(words)],
        [],
        '¿Por qué bajaron los pedidos?',
      ).definitions.map((d) => d.name),
    ).toEqual(['Orders'])
    // The words give it: not again.
    expect(
      turnOf(
        `Orders is ${words}`,
        [subject('partial'), definitions(words)],
        [],
        'Hva betyr ordrer?',
      ).definitions,
    ).toEqual([])
    // A listing of Definitions (by a domain or a kind, no names) reads no one definition: none shows.
    const read = definitions(words)
    const listing: MadeRead = {
      ...read,
      input: { domain: 'Sales' },
      result: {
        ...(read.result as object),
        names: [{ id: 'metric:orders', name: 'Orders', of: null, type: null }],
      },
    }
    expect(
      turnOf('Sales has [@metric:orders].', [{ ...listing, input: { names: ['Orders'] } }], [], 'q')
        .definitions,
    ).toHaveLength(1)
    expect(
      turnOf('Sales has [@metric:orders].', [listing], [], 'List the metrics in Sales').definitions,
    ).toEqual([])
    // An earlier turn read it: a follow-up that reads again does not show it again.
    expect(
      turnOf('Sofia Brandt owns it.', [subject('partial')], [definitions(words)], 'Who owns that?')
        .definitions,
    ).toEqual([])
  })

  it('keeps its state when it is not about a definition, or no definition was read', () => {
    const notAbout = turnOf(
      'Nothing written covers why orders fell.',
      [subject('missing'), definitions('The value of orders customers paid for.')],
      [],
      'Why did orders fall?',
    )
    expect(notAbout.state).toBe('missing')
    expect(notAbout.defined).toBeUndefined()
    // Words that give a definition while answering about something nothing covers stay Not found.
    const notFound = turnOf(
      'Nothing written covers orders here. Orders is the value of orders customers completed and paid for, in euros at the daily rate, with cancelled orders left out.',
      [
        subject('missing', ['metric:orders', 'value:market/poland']),
        definitions(
          'The value of orders customers completed and paid for, in euros at the daily rate, with cancelled orders left out.',
        ),
      ],
      [],
      'Give me all about orders in poland',
    )
    expect(notFound.state).toBe('missing')
    expect(notFound.defined).toBeUndefined()
    const none = turnOf(
      'Nothing is written.',
      [subject('missing'), definitions(null)],
      [],
      'What is orders?',
    )
    expect(none.state).toBe('missing')
    expect(none.defined).toBeUndefined()
    // Asked what is written about a subject nothing covers, whatever the question's words: Not found.
    const written = turnOf(
      'Nothing written covers Orders in Poland.',
      [
        subject('missing', ['metric:orders', 'value:market/poland']),
        definitions('The value of orders customers paid for.'),
      ],
      [],
      "What's written about orders in Poland?",
    )
    expect(written.state).toBe('missing')
    expect(written.defined).toBeUndefined()
    // Asked what a metric nothing is written about is: its definition, under the Definition label.
    const words =
      'The value of orders customers completed and paid for, in euros at the daily rate, with cancelled orders left out.'
    expect(
      turnOf(`Orders is ${words}`, [subject('missing'), definitions(words)], [], 'What is orders?')
        .defined,
    ).toEqual({ names: ['Orders'], tool: 'Cube' })
  })

  it('shows none of the evidence when it read nothing new and cites nothing', () => {
    const earlier = [subject('partial'), definitions('The value of orders customers paid for.')]
    const t = turnOf('You are welcome.', [], earlier, 'thanks!')
    expect(t).toMatchObject({
      state: null,
      subject: null,
      definitions: [],
      read: [],
      footer: { denominator: null, notSeen: null, stale: null },
    })
    // One that cites what an earlier read returned keeps it.
    const cites = turnOf(
      'As before, Germany lags [itm_germany01].',
      [],
      [find([{ ...item('itm_germany01'), match: 'all' }], 1)],
    )
    expect(cites.read).toEqual(['Read the chat’s 1 earlier read again, as you, now.'])
  })
})

describe('the instructions', () => {
  it('say who is asking by what is theirs only, and name no case', () => {
    const system = loopSystem('2026-10-23', { admin: false, owns: ['Sales'] })
    expect(system).toContain('Today is Friday, 23 October 2026 (UTC).')
    expect(system).toContain('They own the domain Sales.')
    // No example of a question, and no market or metric of the demo.
    expect(system).not.toMatch(/Poland|Norway|Orders|are you sure|"/i)
  })

  it('speak to the person as you, of Ask as Ask, and give a definition when asked what it is', () => {
    const system = loopSystem('2026-10-23', { admin: true, owns: [] })
    expect(system).toContain('Speak to the person as “you”')
    expect(system).toContain('of yourself as Ask, never as I or me')
    expect(system).toContain('never write “the person asking”')
    expect(system).toMatch(/Never say how you read the question/)
    expect(system).toMatch(/what something is or means, answer with its definition in one sentence/)
    expect(system).toContain('in every language')
    expect(system).toContain('answer the likelier reading without saying which one you chose')
    // A step that reads writes nothing: words before a read would show, then go.
    expect(system).toContain('In a step that reads, write no words')
    // What the page shows is never said: not even that it lists the nearest items.
    expect(system).not.toContain('say so in one sentence: the page lists what is written nearest')
    // The person's language, with every name as the reads give it.
    expect(system).toContain(
      'Write the names of metrics, dimensions, values, domains and people exactly as the reads give them, never translated',
    )
    // Nothing left that asks for the third person or forbids the definition.
    expect(system).not.toMatch(/third person|never restate a definition|The person asking is/)
  })
})

describe('the question back', () => {
  it('says in its own description when to ask, with the two cases it must not ask on', () => {
    // When: a bare word, or no metric named, and the chat does not settle it.
    expect(ASK_BACK).toMatch(/one bare word, or names no metric/)
    expect(ASK_BACK).toContain('the metrics it could mean as the choices')
    // Never: a follow-up the chat settles, nor a question that names one metric.
    expect(ASK_BACK).toMatch(/Never ask back on a follow-up whose subject the chat already settles/)
    expect(ASK_BACK).toMatch(/nor on a question that names one metric/)
    // The instructions leave the rule to the tool, and only forbid asking in the words.
    const system = loopSystem('2026-10-23', { admin: false, owns: [] })
    expect(system).not.toContain('can mean two things and the answers would differ')
    expect(system).toContain('Ask back only with ask_back, as its description says')
  })
})

/* ---------- the loop on a scripted model ---------- */

/** A database that counts the transactions open at once, each taking a moment. */
function countingDatabase() {
  const seen = { open: 0, most: 0, made: 0 }
  const database: Database = {
    ping: () => Promise.resolve(),
    query: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    async transaction(_person, work) {
      seen.open++
      seen.made++
      seen.most = Math.max(seen.most, seen.open)
      try {
        await new Promise((done) => setTimeout(done, 10))
        return await work({ query: () => Promise.resolve([]) })
      } finally {
        seen.open--
      }
    },
  }
  return { database, seen }
}

/** Tools that answer each read from `results`, and keep what they were asked. */
function fakeTools(results: (name: string, input: unknown) => unknown = () => ({ ids: [] })) {
  const asked: { name: string; input: unknown }[] = []
  const tools = {
    run: (name: string, input: unknown) => {
      asked.push({ name, input })
      return Promise.resolve(results(name, input))
    },
    ai: () => ({}),
  } as unknown as AskTools
  return { tools, asked }
}

async function turnWith(
  decide: (prompt: ScriptedPrompt) => ScriptedStep,
  options: Partial<LoopDeps> & {
    turns?: Parameters<typeof askLoop>[1]['turns']
    question?: string
    /** Each event as the turn yields it, in order. */
    onEvent?: (event: LookupEvent) => void
  } = {},
) {
  const { database, seen } = countingDatabase()
  const { tools, asked } = fakeTools(
    (name, input) =>
      ({
        get_context: get('missing', [], ['itm_germany01']).result,
        find_context: find([{ ...item('itm_germany01'), match: 'all' }], 1).result,
        read_context: { found: false, item: null, nothing: 'none', ids: [] },
      })[name] ?? { input, ids: [] },
  )
  const errors: unknown[] = []
  const events: LookupEvent[] = []
  const { turns, question = 'what is written?', onEvent, ...rest } = options
  for await (const event of askLoop(
    {
      database,
      person: 'p1',
      toolsIn: () => tools,
      model: scriptedLoopChoice('test', decide),
      limits: null,
      asker: { admin: false, owns: [] },
      today: '2026-10-23',
      steps: 6,
      timeoutMs: 5_000,
      onError: (e) => errors.push(e),
      ...rest,
    },
    { question, ...(turns ? { turns } : {}) },
  )) {
    onEvent?.(event)
    events.push(event)
  }
  const turn = events.findLast((e) => e.type === 'turn')?.turn as LoopTurn
  return { turn, events, seen, asked, errors }
}

/**
 * A model that reads once, then writes its answer in pieces with a pause between each, noting each
 * piece as it sends it; `log` notes each words event as the turn yields it, in the same list.
 */
function pacedAnswer(pieces: readonly string[], written: string[]) {
  return {
    decide: ({ results }: ScriptedPrompt): ScriptedStep =>
      results.length
        ? { text: pieces, pace: 20, onPiece: (p) => written.push(`delta:${p}`) }
        : { calls: [{ toolName: 'find_context', input: { words: 'germany' } }] },
    log: (e: LookupEvent) => {
      if (e.type === 'words') written.push(`words:${e.turn?.text ?? ''}`)
    },
  }
}

describe("Ask's loop on a scripted model", () => {
  it('reads, then answers, saying what each read does as it starts', async () => {
    const { turn, events } = await turnWith(({ results }) =>
      results.length
        ? { text: 'Germany lags [itm_germany01].' }
        : { calls: [{ toolName: 'find_context', input: { words: 'germany' } }] },
    )
    // Each read as it starts, then once done, with what it found: by code, from the read.
    expect(events.filter((e) => e.type === 'progress')).toEqual([
      {
        type: 'progress',
        working: 'Searching the context for “germany”…',
        steps: [
          { runs: [{ t: 'text', text: 'Searching the context for “germany”…' }], done: false },
        ],
        nouns: [],
      },
      {
        type: 'progress',
        working: 'Writing the answer…',
        steps: [
          {
            runs: [{ t: 'text', text: 'Searched “payment provider”, any date: 1 found' }],
            done: true,
          },
        ],
        nouns: [],
      },
    ])
    expect(turn).toMatchObject({ kind: 'answer', sources: ['itm_germany01'], state: 'grounded' })
    expect(turn.reads).toEqual([{ tool: 'find_context', input: { words: 'germany', limit: 10 } }])
  })

  it('makes the reads of one step one after the other: one connection at a time', async () => {
    const { seen, asked } = await turnWith(({ results }) =>
      results.length
        ? { text: 'Done.' }
        : {
            calls: [
              { toolName: 'get_context', input: { about: 'a' } },
              { toolName: 'find_context', input: { words: 'b' } },
              { toolName: 'read_context', input: { id: 'itm_germany01' } },
            ],
          },
    )
    expect(asked.map((a) => a.name)).toEqual(['get_context', 'find_context', 'read_context'])
    expect(seen.most).toBe(1)
  })

  it('stops at its step limit, the last step with no reads, and shows only a fixed sentence', async () => {
    const reads: boolean[] = []
    const { turn, errors } = await turnWith(
      ({ canRead }) => {
        reads.push(canRead)
        // A model that keeps reading, even when told it may not.
        return { calls: [{ toolName: 'find_context', input: { words: 'more' } }] }
      },
      { steps: 3 },
    )
    expect(reads).toEqual([true, true, false])
    expect(turn).toMatchObject({ kind: 'stopped', stopped: 'steps', sources: [], state: null })
    expect(errors).toEqual([])
    expect(turn.read.length).toBeGreaterThan(0)
    expect(turn.read.join(' ')).toContain('Searched')
    expect(turn.reads).toEqual([])
    expect(turn.subject).toBeNull()
    expect(turn.text).toBe(
      'Ask stopped at its limit of 3 steps before it had an answer, so nothing it wrote is shown.',
    )
  })

  it('stops at its time limit, and shows nothing the model wrote', async () => {
    const { turn } = await turnWith(() => ({ text: 'Too late [itm_germany01].', delay: 2_000 }), {
      timeoutMs: 100,
    })
    expect(turn).toMatchObject({ kind: 'stopped', stopped: 'time', sources: [] })
    expect(turn.text).toContain('time limit')
  })

  it('says its model failed, in a fixed sentence, and logs only the failure', async () => {
    const { turn, errors } = await turnWith(() => ({ fail: true }))
    expect(turn).toMatchObject({ kind: 'stopped', stopped: 'model' })
    expect(turn.text).toBe("Ask's model did not answer just now, so nothing is shown.")
    expect(errors).toHaveLength(1)
  })

  it('asks one question back, with the readings as choices and no state', async () => {
    const { turn } = await turnWith(() => ({
      calls: [
        {
          toolName: 'ask_back',
          input: { question: 'Which switch do you mean?', choices: ['France', 'Spain'] },
        },
      ],
    }))
    expect(turn).toMatchObject({
      kind: 'question',
      text: 'Which switch do you mean?',
      choices: ['France', 'Spain'],
      state: null,
    })
  })

  it("reads the chat's earlier reads again, as the person, now, before the model sees them", async () => {
    let seenChat = ''
    const { asked, turn } = await turnWith(
      ({ prompt }) => {
        seenChat = JSON.stringify(prompt)
        return { text: 'Still nothing, as before [itm_germany01].' }
      },
      {
        turns: [
          {
            question: 'orders in poland',
            sources: ['itm_germany01', 'itm_hidden0001'],
            // An earlier reply that cites an item a read returns now, and one it does not.
            reply: 'Nothing on Poland. Germany lags [1]. Another item [2] said more.',
            reads: [{ tool: 'get_context', input: { about: 'orders in poland' } }],
          },
        ],
      },
    )
    expect(asked[0]).toEqual({ name: 'get_context', input: { about: 'orders in poland' } })
    // The model reads the earlier reply with its marks as the ids the reads give now, without the
    // sentence that cites an item no read returns now.
    expect(seenChat).toContain('Nothing on Poland. Germany lags [itm_germany01].')
    expect(seenChat).not.toContain('said more')
    expect(seenChat).not.toContain('itm_hidden0001')
    // The earlier read, made again, gives the item only as nearby to a subject with nothing written.
    expect(turn).toMatchObject({ sources: [], state: 'missing', nearby: ['itm_germany01'] })
    // What the turn sends back as its own reply cites by id, a nearby item too: what it wrote.
    expect(turn.said).toBe('Still nothing, as before.[itm_germany01]')
  })

  it('shows the words a checked sentence at a time, the first while the rest is still being written', async () => {
    const written: string[] = []
    const pieces = [
      'Germany lags ',
      '[itm_germany01]. France ',
      'switched in May. ',
      'Nothing else is written.',
    ]
    const { decide, log } = pacedAnswer(pieces, written)
    const { turn, events } = await turnWith(decide, { onEvent: log })
    const words = events.filter((e) => e.type === 'words')
    // Each event is the answer so far, drawn as the turn will be: the sentences that passed.
    expect(words.map((e) => e.turn?.text)).toEqual([
      'Germany lags.[1]',
      'Germany lags.[1] France switched in May.',
    ])
    expect(words[0]!.turn).toMatchObject({ sources: ['itm_germany01'], state: 'grounded' })
    // The first sentence reached the page before the model wrote its last words.
    expect(written.indexOf('words:Germany lags.[1]')).toBeLessThan(
      written.indexOf(`delta:${pieces.at(-1)}`),
    )
    // The turn is the whole answer, the same sentences first.
    expect(turn.text).toBe('Germany lags.[1] France switched in May. Nothing else is written.')
  })

  it('takes back the words of a step that goes on to read, and never shows a lone sentence before a read', async () => {
    const { events } = await turnWith(({ results }) =>
      results.length
        ? { text: 'Germany lags [itm_germany01].' }
        : {
            text: 'Ask will look this up. It reads the context first.',
            calls: [{ toolName: 'find_context', input: { words: 'germany' } }],
          },
    )
    const words = events.filter((e) => e.type === 'words').map((e) => e.turn?.text ?? null)
    // The first sentence was shown, then taken back once the step read; the answer's words follow.
    expect(words).toEqual(['Ask will look this up.', null])
    const { events: lone } = await turnWith(({ results }) =>
      results.length
        ? { text: 'Germany lags [itm_germany01].' }
        : {
            text: 'Ask will look this up.',
            calls: [{ toolName: 'find_context', input: { words: 'germany' } }],
          },
    )
    expect(lone.filter((e) => e.type === 'words')).toEqual([])
  })

  it("holds an earlier reply's citations by id to what the reads return now, as its [n] marks", async () => {
    let seenChat = ''
    await turnWith(
      ({ prompt }) => {
        seenChat = JSON.stringify(prompt)
        return { text: 'Still nothing.' }
      },
      {
        turns: [
          {
            question: 'orders in poland',
            sources: [],
            reply:
              'Nothing on Poland. Germany lags [itm_germany01]. Another item [itm_hidden0001] said more.',
            reads: [{ tool: 'get_context', input: { about: 'orders in poland' } }],
          },
        ],
      },
    )
    expect(seenChat).toContain('Nothing on Poland. Germany lags [itm_germany01].')
    expect(seenChat).not.toContain('said more')
    expect(seenChat).not.toContain('itm_hidden0001')
  })
})

describe('an overview, whatever the model sends of it', () => {
  // The person's Inbox as the inbox tool returns it: two groups, one card about a context item.
  const inbox = {
    count: 3,
    groupsAdd: 3,
    differs: null,
    order: "the Inbox's own order: what needs you first",
    groups: [
      {
        group: 'mention',
        name: 'Mentioned you',
        count: 1,
        cards: [
          {
            id: 'c1',
            group: 'mention',
            title: 'A mention',
            domain: 'Sales',
            domainId: 'domain:area_sales',
            item: null,
            about: [],
            status: 'from Ada',
            date: '2026-10-20',
          },
        ],
        more: 0,
      },
      {
        group: 'check',
        name: 'Due for a check',
        count: 2,
        cards: [
          {
            id: 'c2',
            group: 'check',
            title: 'Germany lags',
            domain: 'Sales',
            domainId: 'domain:area_sales',
            item: 'itm_germany01',
            about: [],
            status: 'its check date passed',
            date: '2026-10-02',
          },
          {
            id: 'c3',
            group: 'check',
            title: 'Another',
            domain: 'Sales',
            domainId: 'domain:area_sales',
            item: null,
            about: [],
            status: 'its check date passed',
            date: '2026-10-01',
          },
        ],
        more: 0,
      },
    ],
    note: '',
    names: [],
    ids: ['c1', 'c2', 'itm_germany01', 'c3'],
  }
  /** Tools whose Inbox read takes `delay` milliseconds, as a first read on a cold service may. */
  const slowInbox = (delay: number, read: object = inbox): AskTools =>
    ({
      run: (name: string) =>
        name === 'inbox'
          ? new Promise((done) => setTimeout(() => done(read), delay))
          : Promise.resolve({ ids: [] }),
      ai: () => ({}),
    }) as unknown as AskTools
  const groupsOf = (turn: LoopTurn) => turn.overview?.groups.map((g) => [g.key, g.rows.length])

  it('waits for a read asked for in the same step before it draws the overview of it', async () => {
    const { turn } = await turnWith(
      ({ step }) =>
        step === 0
          ? {
              calls: [
                { toolName: 'inbox', input: {} },
                { toolName: 'show_overview', input: { from: 'r1' } },
              ],
            }
          : { text: 'Here is the overview by group.' },
      { toolsIn: () => slowInbox(40) },
    )
    expect(groupsOf(turn)).toEqual([
      ['mention', 1],
      ['check', 2],
    ])
    expect(turn.text.split('\n')[0]).toBe('3 cards wait on you in your Inbox, in 2 groups.')
  })

  it('draws the Inbox read as an overview when the words only lead into one', async () => {
    const { turn } = await turnWith(
      ({ step }) =>
        step === 0
          ? { calls: [{ toolName: 'inbox', input: {} }] }
          : { text: 'Your Inbox holds [#r1.count] cards in total. Here is the overview by group.' },
      { toolsIn: () => slowInbox(0) },
    )
    expect(groupsOf(turn)).toEqual([
      ['mention', 1],
      ['check', 2],
    ])
  })

  it('draws the read itself when the overview the model asked for names no read the page can draw', async () => {
    const { turn } = await turnWith(
      ({ step }) =>
        step === 0
          ? { calls: [{ toolName: 'inbox', input: {} }] }
          : step === 1
            ? { calls: [{ toolName: 'show_overview', input: { from: 'r9', groups: ['nope'] } }] }
            : { text: 'Here it is.' },
      { toolsIn: () => slowInbox(0) },
    )
    expect(groupsOf(turn)).toEqual([
      ['mention', 1],
      ['check', 2],
    ])
  })

  it('keeps the model text when the overview it asked for failed and it then answered with a body', async () => {
    const { turn } = await turnWith(
      ({ step }) =>
        step === 0
          ? { calls: [{ toolName: 'inbox', input: {} }] }
          : step === 1
            ? { calls: [{ toolName: 'show_overview', input: { from: 'r9', groups: ['nope'] } }] }
            : { text: 'Two cards are due:\n- Germany lags [itm_germany01]\n- Another' },
      { toolsIn: () => slowInbox(0) },
    )
    expect(turn.overview).toBeNull()
    expect(turn.body.map((b) => b.t)).toEqual(['p', 'ul'])
  })

  // The words of a real try of "what do i need to handle?" that showed no groups: a lead, then a
  // list of its own with citations, and no overview asked for.
  const handleWords =
    'Your Inbox holds 20 cards, and the largest group is 11 suggestions. The Inbox is shown below in its own order, with what needs you first.\n\nSeveral cards need attention beyond suggestions: three context items are due for a check, including [itm_germany01] (Returns changed definition on 28 April 2026, for [@value:market/norway]) and [itm_another01] (a Marketing item on price promotions in [@value:market/italy]). The Orders in Spain question has been asked 9 times and nothing written covers it. Two alerts report syncs that did not complete, and one reported wrong answer is waiting.'
  const handled = (question: string, read: object = inbox) =>
    turnWith(
      ({ step }) =>
        step === 0 ? { calls: [{ toolName: 'inbox', input: {} }] } : { text: handleWords },
      { toolsIn: () => slowInbox(0, read), question },
    )

  it('draws the Inbox when the question asks for what waits, the words kept only as its lead line', async () => {
    const { turn } = await handled('what do i need to handle?')
    expect(groupsOf(turn)).toEqual([
      ['mention', 1],
      ['check', 2],
    ])
    // The words' first paragraph leads; their own list and the rest are what the groups show.
    expect(turn.body).toEqual([
      {
        t: 'p',
        runs: [
          {
            t: 'text',
            text: 'Your Inbox holds 20 cards, and the largest group is 11 suggestions. The Inbox is shown below in its own order, with what needs you first.',
          },
        ],
      },
    ])
    expect(turn.text.split('\n\n')[1]?.split('\n')[0]).toBe(
      '3 cards wait on you in your Inbox, in 2 groups.',
    )
    expect(turn.text).not.toContain('Several cards')
    // One numbering: the rows', in reading order.
    expect(turn.sources).toEqual(['itm_germany01'])
  })

  it('draws it for every question that asks for the whole of what waits, and no narrower one', async () => {
    const drawn = async (question: string) => (await handled(question)).turn.overview !== null
    for (const question of [
      'what have I got on today?',
      'give me a Monday morning summary of what needs doing',
      "what's waiting for me?",
      'what should I do first?',
    ])
      expect(await drawn(question), question).toBe(true)
    for (const question of [
      'is anything about Germany waiting?',
      'what have we got on the italy regulator?',
      'give me a summary of the Spain card outage',
      'what needs attention in Spain?',
    ])
      expect(await drawn(question), question).toBe(false)
  })

  it('keeps those words as the answer when the question asks for no set, or the Inbox holds none', async () => {
    for (const { turn } of [
      await handled('is anything about Germany waiting?'),
      await handled('what do i need to handle?', { ...inbox, count: 0, groupsAdd: 0, groups: [] }),
    ]) {
      expect(turn.overview).toBeNull()
      expect(turn.text).toContain('Several cards need attention beyond suggestions')
    }
  })

  it('keeps words that answer from the Inbox when they list what they answer', async () => {
    const { turn } = await turnWith(
      ({ step }) =>
        step === 0
          ? { calls: [{ toolName: 'inbox', input: {} }] }
          : { text: 'Two cards are due:\n- Germany lags [itm_germany01]\n- Another' },
      { toolsIn: () => slowInbox(0) },
    )
    expect(turn.overview).toBeNull()
    expect(turn.body.map((b) => b.t)).toEqual(['p', 'ul'])
  })
})
