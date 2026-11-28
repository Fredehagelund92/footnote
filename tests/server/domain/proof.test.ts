import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  notesFile,
  proofChecks,
  proofProblems,
  proofScore,
  proofSetSchema,
  proofTable,
  scoreWords,
  servedNotes,
  type ProofNote,
  type ProofQuestion,
} from '../../../src/domain/proof.ts'

/*
  The proof's own rules (src/domain/proof.ts): the question format, the judge's checks and what
  an answer scores from them, the plain file the second way is given, and the table.
*/

const note = (over: Partial<ProofNote> & { id: string }): ProofNote => ({
  kind: 'event',
  title: 'Online sales to Norway stopped on 4 August 2026',
  summary: 'A customs rule stopped online sales to Norway.',
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
  },
  validity: { start: '2026-08-04', end: null },
  audience: { kind: 'everyone' },
  notToConclude: 'cause not proven',
  evidence: [{ url: 'https://customs.example/norway', quote: 'Parcels are held at the border.' }],
  owner: { team: null },
  ...over,
})
const question = (over: Partial<ProofQuestion> = {}): ProofQuestion => ({
  id: 'orders-norway-october',
  as_of: '2026-10-23',
  question: 'Why are orders in Norway close to nothing in October 2026?',
  reasons: ['itm_norway001'],
  wrong: ['itm_ended0001'],
  ...over,
})

describe('the question format', () => {
  it('takes the template as it stands', () => {
    const text = readFileSync(
      new URL('../../../docs/templates/prove-questions.yaml', import.meta.url),
      'utf8',
    )
    const value = parse(text) as unknown
    expect(proofProblems(value)).toEqual([])
    const { questions } = proofSetSchema.parse(value)
    // One of each kind a good set has, and one where nothing is written.
    expect(questions).toHaveLength(4)
    expect(questions.filter((q) => q.reasons.length === 0)).toHaveLength(1)
  })

  it('names the path and the rule of each problem, never the words', () => {
    const problems = proofProblems({
      questions: [
        { ...question(), wrong: ['itm_norway001'] },
        { ...question(), as_of: '23 October' },
        { ...question({ id: 'x' }), secret: 'CANARY7Q' },
      ],
    })
    expect(problems).toEqual(
      expect.arrayContaining([
        'questions.0.wrong: A note cannot be both a reason and wrong',
        'questions.1.as_of: Expected a date like 2026-10-23',
        expect.stringMatching(/^questions\.2\.id: /),
      ]),
    )
    expect(problems.join(' ')).not.toContain('CANARY7Q')
    expect(proofProblems({ questions: [question(), question()] })).toEqual([
      'questions: Give each question its own id',
    ])
    expect(proofProblems([question()])).not.toEqual([])
  })

  it('keeps a question to the notes the judge can grade', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `itm_many000${i}`)
    expect(proofProblems({ questions: [question({ reasons: ids, wrong: [] })] })).toEqual([
      'questions.0.wrong: Name at most 9 notes in reasons and wrong together',
    ])
  })
})

describe('the checks and the score', () => {
  const notes = new Map([
    ['itm_norway001', note({ id: 'itm_norway001' })],
    ['itm_ended0001', note({ id: 'itm_ended0001', title: 'A "quoted" campaign in Norway' })],
  ])

  it('asks about each note, and about nothing written only where nothing is', () => {
    const { checks, rubrics } = proofChecks(question(), notes)
    expect(checks).toEqual([
      { kind: 'reason', note: 'itm_norway001' },
      { kind: 'wrong', note: 'itm_ended0001' },
    ])
    expect(rubrics[0]).toContain('"Online sales to Norway stopped on 4 August 2026"')
    // A title's own quotes do not end the quoted title the scripted judge reads.
    expect(rubrics[1]).toContain(`"A 'quoted' campaign in Norway"`)
    expect(rubrics.every((r) => r.length <= 300)).toBe(true)
    const none = proofChecks(question({ reasons: [] }), notes)
    expect(none.checks.at(-1)).toEqual({ kind: 'nothing' })
    expect(none.rubrics.at(-1)).toContain('"nothing is written"')
  })

  it('counts the right reason only with no wrong one', () => {
    const { checks } = proofChecks(question(), notes)
    expect(proofScore(checks, [true, false])).toEqual({ right: true, wrong: false, nothing: null })
    expect(proofScore(checks, [true, true])).toEqual({ right: false, wrong: true, nothing: null })
    expect(proofScore(checks, [false, false])).toEqual({
      right: false,
      wrong: false,
      nothing: null,
    })
  })

  it('counts saying nothing is written as right where nothing is', () => {
    const { checks } = proofChecks(question({ reasons: [] }), notes)
    expect(proofScore(checks, [false, true])).toEqual({ right: true, wrong: false, nothing: true })
    // Said nothing is written, but told the other market's note too.
    expect(proofScore(checks, [true, true])).toEqual({ right: false, wrong: true, nothing: true })
    expect(proofScore(checks, [false, false])).toEqual({
      right: false,
      wrong: false,
      nothing: false,
    })
  })
})

describe('the plain file', () => {
  it('holds the same facts as dated lines, by the names people use', () => {
    const names = new Map([
      ['metric:orders', 'Orders'],
      ['dim:market', 'Market'],
      ['val:market/norway', 'Norway'],
    ])
    const file = notesFile(
      [
        note({ id: 'itm_norway001', body: 'Parcels are held at the border.' }),
        note({
          id: 'itm_ended0001',
          title: 'Campaign in Norway',
          validity: { start: '2026-02-17', end: '2026-03-07' },
          evidence: [],
        }),
      ],
      names,
    )
    expect(file).toContain('## Online sales to Norway stopped on 4 August 2026')
    expect(file).toContain('About: Orders, for Market Norway. Applies from 4 August 2026 on.')
    expect(file).toContain('Parcels are held at the border.')
    expect(file).toContain('Source: https://customs.example/norway')
    expect(file).toContain('Applies from 17 February to 6 March 2026.')
    // A plain file has no ids: it is what a team writes, not what Footnote serves.
    expect(file).not.toContain('itm_')
  })

  it('holds only the notes an agent with no group may be told', () => {
    const notes = [
      { ...note({ id: 'itm_open00001' }), areaId: 'sales', status: 'accepted' },
      {
        ...note({ id: 'itm_group0001', audience: { kind: 'groups', groups: ['finance'] } }),
        areaId: 'sales',
        status: 'accepted',
      },
      { ...note({ id: 'itm_stopd0001' }), areaId: 'sales', status: 'accepted' },
      { ...note({ id: 'itm_other0001' }), areaId: 'paused', status: 'accepted' },
    ]
    const stopped = { all: false, areas: ['paused'], items: ['itm_stopd0001'] }
    expect(servedNotes(notes, stopped).map((n) => n.id)).toEqual(['itm_open00001'])
    expect(servedNotes(notes, { ...stopped, all: true })).toEqual([])
  })
})

describe('the table', () => {
  it('gives the middle try with every try beside it', () => {
    expect(scoreWords([29, 33, 31], 40)).toBe('31 of 40 (29, 33, 31)')
    expect(scoreWords([3, 4], 10)).toBe('3 of 10 (3, 4)')
    expect(scoreWords([7], 10)).toBe('7 of 10')
  })

  it('has a row for each way, and "-" where a way cannot do what a column counts', () => {
    const tries = (right: number, wrong: number, nothing: number) =>
      Array.from({ length: 3 }, () => ({ right, wrong, nothing }))
    const lines = proofTable(
      [
        { arm: 'none', tries: tries(2, 0, 9), noAnswer: 0 },
        { arm: 'file', tries: tries(20, 14, 3), noAnswer: 0 },
        { arm: 'footnote', tries: tries(31, 2, 8), noAnswer: 0 },
      ],
      40,
      10,
      'Footnote',
    )
    expect(lines).toEqual([
      '                 Right reason,           Told a note that had     Said nothing is',
      '                 no wrong one            ended or was elsewhere   written when true',
      'No context       2 of 40 (2, 2, 2)       -                        9 of 10 (9, 9, 9)',
      'One plain file   20 of 40 (20, 20, 20)   14 of 40 (14, 14, 14)    3 of 10 (3, 3, 3)',
      'Footnote         31 of 40 (31, 31, 31)   2 of 40 (2, 2, 2)        8 of 10 (8, 8, 8)',
    ])
  })
})
