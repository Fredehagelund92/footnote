import { describe, expect, it } from 'vitest'
import type { LookupEvent } from '../../src/contract/answer.ts'
import type { Database } from '../../src/server/db/database.ts'
import {
  askLoop,
  scriptedLoopChoice,
  scriptedLoopModel,
  type AskTools,
  type LoopDeps,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../src/server/modules/answer/index.ts'
import {
  answerCheck,
  checkContext,
  checkedStart,
  CHECK_REQUEST,
  UNCHECKED,
  withUnchecked,
} from '../../src/server/modules/answer/loop-check.ts'

/*
  The answer check of Ask's loop (FR-720.10), without a database: each sentence the model wrote
  held to what the chat read (numbers, citations and the counts of what agents asked the reader may
  not see), and on a scripted model that writes each kind of failure, the answer written again once
  out of the person's sight, then a fixed sentence for what still fails, never a sentence left out
  without a word.
*/

const germany = {
  id: 'itm_germany01',
  title: 'Germany orders lag',
  summary: "Germany's source lags by one day.",
  outOfDate: null,
  match: 'all',
}
const found = {
  found: 1,
  everyWord: 1,
  items: [germany],
  definitions: [],
  outOf: { count: 21, of: 'published context items you can see' },
  more: 0,
  ids: ['itm_germany01'],
}
const asked = {
  week: '9 to 15 November 2026',
  minimum: 5,
  topics: [
    {
      title: 'Orders in Norway',
      domain: 'Sales',
      calls: '13+',
      exact: null,
      atLeast: 13,
      foundNothing: 'fewer than 5',
      stateNow: 'grounded',
      itemsNow: 2,
      about: [],
    },
    {
      title: 'Net revenue in Spain',
      domain: 'Sales',
      calls: '9',
      exact: 9,
      atLeast: 9,
      foundNothing: '2',
      stateNow: 'grounded',
      itemsNow: 1,
      about: [],
    },
  ],
  more: 0,
  total: null,
  listedAtLeast: 22,
  notListed: [],
  note: 'A count with + is a floor.',
  names: [],
  ids: ['Orders in Norway', 'Net revenue in Spain'],
}
const idsOf = (r: unknown) => (r as { ids?: string[] }).ids ?? []
const ctx = (said: string[] = ['how long does germany lag?', '2026-11-18']) =>
  checkContext([found, asked], said, idsOf)

describe('the answer check, by code', () => {
  it('passes the numbers a read returned, the person wrote and the references to reads', () => {
    expect(
      answerCheck(
        'Of the 21 published items, Germany lags [itm_germany01]. Since [#r1.outOf], as of 18 November 2026.',
        ctx(),
      ),
    ).toEqual([])
    expect(answerCheck('You asked about 47 days.', ctx(['is it 47 days?']))).toEqual([])
  })

  it('fails a number in digits of its own, by its sentence and why', () => {
    expect(answerCheck('Germany lags [itm_germany01]. It lags by 47 hours.', ctx())).toEqual([
      {
        kind: 'number',
        sentence: 'It lags by 47 hours.',
        why: 'it gives 47 in digits of its own, which no read returned and the person did not write',
      },
    ])
  })

  it('fails a citation of an item no read returned, or a number in brackets', () => {
    expect(answerCheck('Germany lags [itm_unknown99].', ctx())).toMatchObject([
      { kind: 'citation', sentence: 'Germany lags [itm_unknown99].' },
    ])
    expect(answerCheck('Germany lags [4].', ctx())).toMatchObject([{ kind: 'citation' }])
    // A mention or a definition's id in brackets is no citation.
    expect(answerCheck('[@metric:orders] is a metric [metric:orders].', ctx())).toEqual([])
  })

  it('fails a count of what agents asked that the reader sees only as a floor, or not at all', () => {
    expect(answerCheck('Agents asked about Orders in Norway 13 times.', ctx())).toMatchObject([
      { kind: 'hidden', why: 'it gives Orders in Norway as 13, where the person sees only 13+' },
    ])
    expect(answerCheck('Agents asked about Orders in Norway 13+ times.', ctx())).toEqual([])
    // Its own exact numbers, the minimum, and days or lengths of time are no count of its calls.
    expect(
      answerCheck(
        'In the last 7 full days, Orders in Norway was asked 13+ times, fewer than 5 found nothing, and 2 items cover it now.',
        ctx(),
      ),
    ).toEqual([])
    expect(answerCheck('Net revenue in Spain was asked about 9 times.', ctx())).toEqual([])
    const unlisted = checkContext(
      [{ ...asked, topics: [], notListed: ['orders in Poland'] }],
      [],
      idsOf,
    )
    expect(answerCheck('Orders in Poland was asked about 7 times.', unlisted)).toContainEqual({
      kind: 'hidden',
      sentence: 'Orders in Poland was asked about 7 times.',
      why: 'it gives a count for orders in Poland, which the person may not see',
    })
    // The minimum the page names is no count of the topic.
    expect(answerCheck('Orders in Poland was asked about fewer than 5 times.', unlisted)).toEqual(
      [],
    )
  })

  it('names the words that break the voice, so the second writing knows what to leave out', () => {
    const [found] = answerCheck(
      'Ask checked 21 published context items you can see and none of them names Poland.',
      ctx(),
    ).filter((f) => f.kind === 'voice')
    expect(found?.why).toBe(
      'its words “Ask checked” speak as I or me, or tell of a read, a search or a check that was made; leave those words out and state only what is written, as Ask, with no word of reading, searching, checking or finding',
    )
    const [read] = answerCheck(
      'Of those calls, fewer than 5 found no context: the read gives only that floor.',
      ctx(),
    ).filter((f) => f.kind === 'voice')
    expect(read?.why).toMatch(/^its words “the read” speak as I or me/)
  })

  it('replaces each sentence that failed with the fixed sentence, once for those in a row', () => {
    const text = [
      'Germany lags [itm_germany01]. It lags by 47 hours. And by 48 minutes.',
      '',
      '- Spain: 21 items.',
      '- Norway: 99 items.',
      '[list:r1]',
    ].join('\n')
    const failed = answerCheck(text, ctx())
    expect(failed.map((f) => f.sentence)).toEqual([
      'It lags by 47 hours.',
      'And by 48 minutes.',
      'Norway: 99 items.',
    ])
    expect(withUnchecked(text, failed)).toBe(
      [
        `Germany lags [itm_germany01]. ${UNCHECKED}`,
        '',
        '- Spain: 21 items.',
        `- ${UNCHECKED}`,
        '[list:r1]',
      ].join('\n'),
    )
    expect(answerCheck(withUnchecked(text, failed), ctx())).toEqual([])
  })

  it('holds the words to one voice, and keeps a sentence that only breaks the voice', () => {
    const text = [
      'I read what is written about Germany [itm_germany01].',
      'Footnote does not record who wrote the item.',
      'Footnote keeps no order figures.',
    ].join(' ')
    const failed = answerCheck(text, ctx())
    expect(failed.map((f) => f.kind)).toEqual(['voice', 'claim'])
    // A sentence in Ask's own voice that is true is shown as written again; a claim no read
    // returned is not.
    expect(withUnchecked(text, failed)).toBe(
      `${text.split('. ')[0]}. ${UNCHECKED} Footnote keeps no order figures.`,
    )
    expect(
      answerCheck('Germany covers 1 Apr to 30 Jun 2026 (1 April to 30 June 2026).', ctx()),
    ).toContainEqual(expect.objectContaining({ kind: 'period' }))
  })

  it('shows only the start of the words before the first sentence that fails', () => {
    expect(checkedStart('Germany lags [itm_germany01]. It lags by 47 hours. Fine.', ctx())).toBe(
      'Germany lags [itm_germany01].',
    )
    expect(checkedStart('Lags:\n- by 47 hours.', ctx())).toBe('Lags:')
    expect(checkedStart('It lags by 47 hours.', ctx())).toBe('')
    expect(checkedStart('Germany lags [itm_germany01].', ctx())).toBe(
      'Germany lags [itm_germany01].',
    )
  })
})

/* ---------- on a scripted model ---------- */

function database(): Database {
  return {
    ping: () => Promise.resolve(),
    query: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    transaction: (_person, work) => work({ query: () => Promise.resolve([]) }),
  }
}

const tools = {
  run: (name: string) =>
    Promise.resolve(
      name === 'agent_questions' ? asked : name === 'find_context' ? found : { ids: [] },
    ),
  vague: () => Promise.resolve(null),
  card: () => Promise.resolve(null),
  ai: () => ({}),
} as unknown as AskTools

async function turnWith(
  decide: (prompt: ScriptedPrompt) => ScriptedStep,
  options: Partial<LoopDeps> & { question?: string; signal?: AbortSignal } = {},
) {
  const errors: unknown[] = []
  const events: LookupEvent[] = []
  const { question = 'how long does germany lag?', ...rest } = options
  for await (const event of askLoop(
    {
      database: database(),
      person: 'p1',
      toolsIn: () => tools,
      model: scriptedLoopChoice('test', decide),
      limits: null,
      asker: { admin: false, owns: [] },
      today: '2026-11-18',
      steps: 6,
      timeoutMs: 5_000,
      onError: (e) => errors.push(e),
      ...rest,
    },
    { question },
  ))
    events.push(event)
  const turn = events.findLast((e) => e.type === 'turn')?.turn
  const words = events.flatMap((e) => (e.type === 'words' ? [e.turn?.text ?? null] : []))
  return { turn, events, words, errors }
}

/**
 * A model that reads once, then writes `first`, and when told its answer failed the check writes
 * `again` (or fails, or takes too long); every request it gets is kept.
 */
function writer(
  first: string | readonly string[],
  again: Partial<ScriptedStep> & { text?: string },
) {
  const seen: ScriptedPrompt[] = []
  const decide = (p: ScriptedPrompt): ScriptedStep => {
    seen.push(p)
    if (p.question.startsWith(CHECK_REQUEST)) return again
    return p.results.length
      ? { text: first, pace: 5 }
      : {
          calls: [
            { toolName: 'find_context', input: { words: 'germany' } },
            { toolName: 'agent_questions', input: {} },
          ],
        }
  }
  return { decide, seen }
}

describe("the answer check in Ask's loop", () => {
  it('asks the model once when every sentence passes', async () => {
    const { decide, seen } = writer('Germany lags by one day [itm_germany01].', {})
    const { turn } = await turnWith(decide)
    expect(seen).toHaveLength(2)
    expect(turn).toMatchObject({ text: 'Germany lags by one day.[1]', sources: ['itm_germany01'] })
    expect(turn!.checks.filter((c) => c.kind === 'answer' || c.kind === 'unchecked')).toEqual([])
  })

  it('writes a failing answer again once, out of sight, and shows the rewrite whose sentence holds the fact asked for', async () => {
    const { decide, seen } = writer(
      ['Germany lags ', '[itm_germany01]. ', 'It lags by 47 hours. ', 'Nothing else is written.'],
      {
        text: 'Germany lags [itm_germany01]. Its source lags by one day. Nothing else is written.',
      },
    )
    const { turn, words, events } = await turnWith(decide)
    // The failing sentence, and every one after it, never reached the page.
    expect(words).toEqual(['Germany lags.[1]'])
    expect(events).toContainEqual({
      type: 'progress',
      working: 'Checking the answer against what was read…',
    })
    // Asked again once, told the sentence and why, with what the chat read.
    expect(seen).toHaveLength(3)
    const request = seen.at(-1)!
    expect(request.canRead).toBe(false)
    expect(request.question).toContain(
      '- "It lags by 47 hours.": it gives 47 in digits of its own, which no read returned and the person did not write.',
    )
    expect(JSON.stringify(request.prompt)).toContain("Germany's source lags by one day.")
    expect(turn).toMatchObject({
      kind: 'answer',
      text: 'Germany lags.[1] Its source lags by one day. Nothing else is written.',
      sources: ['itm_germany01'],
      state: 'grounded',
    })
    expect(turn!.checks).toContainEqual({ kind: 'answer', words: 'number' })
    expect(turn!.checks.some((c) => c.kind === 'unchecked')).toBe(false)
  })

  it('replaces a sentence that fails again with the fixed sentence, and keeps the rest', async () => {
    const { decide, seen } = writer(
      'Germany lags [itm_germany01]. It lags by 47 hours. Nothing else is written.',
      { text: 'Germany lags [itm_germany01]. It lags by 46 hours. Nothing else is written.' },
    )
    const { turn } = await turnWith(decide)
    expect(seen).toHaveLength(3)
    expect(turn!.text).toBe(`Germany lags.[1] ${UNCHECKED} Nothing else is written.`)
    expect(turn!.checks).toContainEqual({ kind: 'unchecked', words: 'number' })
  })

  it.each([
    ['a citation of an item no read returned', 'It lags, says another item [itm_unknown99].'],
    ['a floor said as an exact count', 'Agents asked about Orders in Norway 13 times.'],
  ])('holds %s to the same check', async (_, sentence) => {
    const { decide } = writer(`Germany lags [itm_germany01]. ${sentence}`, {
      text: `Germany lags [itm_germany01]. ${sentence}`,
    })
    const { turn } = await turnWith(decide)
    expect(turn!.text).toBe(`Germany lags.[1] ${UNCHECKED}`)
  })

  it('shows the fixed sentence when the rewrite fails or runs out of time, and logs only a failure', async () => {
    const failing = writer('Germany lags [itm_germany01]. It lags by 47 hours.', { fail: true })
    const failed = await turnWith(failing.decide)
    expect(failed.turn).toMatchObject({ kind: 'answer', text: `Germany lags.[1] ${UNCHECKED}` })
    expect(failed.errors).toHaveLength(1)

    const slow = writer('Germany lags [itm_germany01]. It lags by 47 hours.', {
      text: 'Too late.',
      delay: 2_000,
    })
    const late = await turnWith(slow.decide, { timeoutMs: 300 })
    expect(late.turn).toMatchObject({ kind: 'answer', text: `Germany lags.[1] ${UNCHECKED}` })
    expect(late.errors).toEqual([])
  })

  it('sends nothing more when the person stops it while the answer is written again', async () => {
    const stop = new AbortController()
    const { decide } = writer('Germany lags [itm_germany01]. It lags by 47 hours.', {
      text: 'Never shown.',
      delay: 1_000,
    })
    setTimeout(() => stop.abort(), 200)
    const { turn } = await turnWith(decide, { signal: stop.signal })
    expect(turn).toBeUndefined()
  })

  it('on the scripted reader, writes its words again as they were', async () => {
    const reader = scriptedLoopModel().model as unknown as {
      doStream: (o: object) => Promise<{ stream: ReadableStream<{ type: string; delta?: string }> }>
    }
    const { stream } = await reader.doStream({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'how long does germany lag?' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'It lags by 47 hours.' }] },
        { role: 'user', content: [{ type: 'text', text: `${CHECK_REQUEST}\n- "It lags…"` }] },
      ],
      toolChoice: { type: 'none' },
    })
    let text = ''
    for await (const part of stream) if (part.type === 'text-delta') text += part.delta
    expect(text).toBe('It lags by 47 hours.')
  })
})
