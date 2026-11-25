/**
 * The proof (`footnote prove`): the same questions about a period and a market asked three ways
 * through a real agent, with no context, with the same facts as one plain file, and with
 * Footnote, and a table of what each way got right. A question names the notes that give the right
 * reason and the notes that must not be told, because they had ended or are about another market;
 * a question with no right reason is one where nothing is written. Pure definitions, the plain
 * file, the judge's checks and the table: no input or output.
 */
import * as z from 'zod/mini'
import { questionIdSchema } from './golden-question.ts'
import { audienceAllows, noGroups, type Audience, type Scope } from './item.ts'
import { periodWords } from './dates.ts'
import { isCalendarDate } from './validity.ts'

/**
 * Every way a question can be asked. The fourth is a lab's: Footnote with the part of the reply
 * about what an asked metric is built from (built-from.ts). A run asks `proofWays` or
 * `builtFromWays`, and its table shows them in the order that list gives.
 */
export const proofArms = ['none', 'file', 'footnote', 'built_from'] as const
export type ProofArm = (typeof proofArms)[number]
/** The three ways a proof asks. */
export const proofWays = ['none', 'file', 'footnote'] as const satisfies readonly ProofArm[]
/** The ways the built-from lab asks (FOOTNOTE_LAB_BUILT_FROM): Footnote as it is, and with it. */
export const builtFromWays = ['footnote', 'built_from'] as const satisfies readonly ProofArm[]
/** Each way's row in the table; the third is the product's own name (`productName`). */
export const proofArmWords = (product: string): Readonly<Record<ProofArm, string>> => ({
  none: 'No context',
  file: 'One plain file',
  footnote: product,
  built_from: `${product}, built from`,
})
/** "three ways", as the command says how many ways it asks. */
export const waysWords = (n: number) =>
  `${['one', 'two', 'three', 'four'][n - 1] ?? n} ${n === 1 ? 'way' : 'ways'}`

/** How many tries each question gets unless the command says otherwise. */
export const PROOF_TRIES = 3

const itemId = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/, 'Expected an item id'))
const date = z.string().check(z.refine(isCalendarDate, 'Expected a date like 2026-10-23'))

/**
 * The judge grades one check for each note a question names, and one for "nothing is written":
 * the judge's rubrics hold ten at most.
 */
const MAX_NOTES = 9

export const proofQuestionSchema = z
  .strictObject({
    id: questionIdSchema,
    /** The day it is asked on: the agent's today, and Footnote's, so the result is the same each run. */
    as_of: date,
    question: z.string().check(z.minLength(10), z.maxLength(1000)),
    /** The notes that give the right reason. None means nothing is written. */
    reasons: z._default(z.array(itemId), []),
    /** The notes an answer must not tell: one that had ended, or one about another market. */
    wrong: z._default(z.array(itemId), []),
  })
  .check(
    z.refine((q) => !q.reasons.some((id) => q.wrong.includes(id)), {
      message: 'A note cannot be both a reason and wrong',
      path: ['wrong'],
    }),
    z.refine(
      (q) => new Set([...q.reasons, ...q.wrong]).size === q.reasons.length + q.wrong.length,
      {
        message: 'Name each note once',
        path: ['reasons'],
      },
    ),
    z.refine((q) => q.reasons.length + q.wrong.length <= MAX_NOTES, {
      message: `Name at most ${MAX_NOTES} notes in reasons and wrong together`,
      path: ['wrong'],
    }),
  )
export type ProofQuestion = z.infer<typeof proofQuestionSchema>

/** The file format (YAML or JSON): the questions under `questions`. */
export const proofSetSchema = z
  .strictObject({
    questions: z.array(proofQuestionSchema).check(z.minLength(1), z.maxLength(200)),
  })
  .check(
    z.refine((s) => new Set(s.questions.map((q) => q.id)).size === s.questions.length, {
      message: 'Give each question its own id',
      path: ['questions'],
    }),
  )
export type ProofSet = z.infer<typeof proofSetSchema>

/** Where a parsed file fails the format: paths and rules only, never a question's words. */
export function proofProblems(value: unknown): string[] {
  const parsed = proofSetSchema.safeParse(value)
  return parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(top)'}: ${i.message}`)
}

/** Whether a question is one where nothing is written. */
export const nothingWritten = (q: Pick<ProofQuestion, 'reasons'>) => q.reasons.length === 0

/** Every note the questions name, once each. */
export const namedNotes = (questions: readonly ProofQuestion[]) => [
  ...new Set(questions.flatMap((q) => [...q.reasons, ...q.wrong])),
]

/** A published note, as the plain file and the judge read it. */
export type ProofNote = {
  id: string
  kind: string
  title: string
  summary: string
  body?: string | undefined
  scope: Scope
  validity: { start: string; end: string | null }
  audience: Audience
  notToConclude: string
  evidence: readonly { url: string }[]
  owner: { team: string | null }
}

/** The notes an agent with no group may be told: those for everyone, unless serving is stopped. */
export function servedNotes<N extends ProofNote & { areaId: string; status: string }>(
  notes: readonly N[],
  stopped: { all: boolean; areas: readonly string[]; items: readonly string[] },
): N[] {
  if (stopped.all) return []
  return notes.filter(
    (n) =>
      n.status === 'accepted' &&
      audienceAllows(n.audience, noGroups) &&
      !stopped.areas.includes(n.areaId) &&
      !stopped.items.includes(n.id),
  )
}

/** The words of a note's scope: "Orders, for Market Norway", by the names the vocabulary gives. */
function scopeWords(scope: Scope, names: ReadonlyMap<string, string>): string {
  const name = (key: string) => names.get(key) ?? key
  const metrics = scope.metrics.map(name)
  const values = scope.dimensionValues.map((v) => `${name(v.dimension)} ${name(v.value)}`)
  const any = scope.dimensions.map((d) => `every ${name(d)}`)
  const where = [...values, ...any]
  return [
    metrics.length ? metrics.join(', ') : 'every metric',
    ...(where.length ? [`for ${where.join(', ')}`] : []),
  ].join(', ')
}

/**
 * The same facts as one plain file, as a team keeps its notes in a repository: one dated section
 * per note with its title, what it is about, when it applies, the text, what not to conclude and
 * its source. No id, no owner's check and no matching: the file is what a careful team writes.
 */
export function notesFile(notes: readonly ProofNote[], names: ReadonlyMap<string, string>): string {
  const sections = notes.map((n) =>
    [
      `## ${n.title}`,
      '',
      `About: ${scopeWords(n.scope, names)}. Applies ${periodWords(n.validity)}.`,
      '',
      n.summary,
      ...(n.body ? ['', n.body] : []),
      '',
      `Do not conclude: ${n.notToConclude}`,
      ...(n.evidence[0] ? [`Source: ${n.evidence[0].url}`] : []),
    ].join('\n'),
  )
  return [
    '# Notes about our data',
    '',
    'What we know about why numbers moved, one note per section.',
    '',
    ...sections.flatMap((s) => [s, '']),
  ].join('\n')
}

/** What a check of the judge's is about: a note that gives the reason, a wrong one, or none. */
export type ProofCheck = { kind: 'reason' | 'wrong'; note: string } | { kind: 'nothing' }

/** The judge's rubric for a check. A quoted title lets the scripted judge read it too. */
function rubricOf(check: ProofCheck, notes: ReadonlyMap<string, ProofNote>): string {
  if (check.kind === 'nothing')
    return 'Says plainly that nothing written explains it ("nothing is written"), and gives no note as the reason.'
  const note = notes.get(check.note)
  const title = (note?.title ?? check.note).replaceAll('"', "'")
  const text = `Tells this note as a reason, or as applying to the question: "${title}". The note says: ${note?.summary ?? ''}`
  return text.length > 300 ? `${text.slice(0, 297)}...` : text
}

/**
 * The judge's checks of one question, the same for every way it is asked: each note it names,
 * and "nothing is written" when nothing is.
 */
export function proofChecks(
  q: ProofQuestion,
  notes: ReadonlyMap<string, ProofNote>,
): { checks: ProofCheck[]; rubrics: string[] } {
  const checks: ProofCheck[] = [
    ...q.reasons.map((note) => ({ kind: 'reason' as const, note })),
    ...q.wrong.map((note) => ({ kind: 'wrong' as const, note })),
    ...(nothingWritten(q) ? [{ kind: 'nothing' as const }] : []),
  ]
  return { checks, rubrics: checks.map((c) => rubricOf(c, notes)) }
}

/** What one answer got, from the judge's grade of each check. */
export type ProofScore = {
  /** The right reason and no wrong one; for a question where nothing is written, saying so. */
  right: boolean
  /** It told a note that had ended or was about another market. */
  wrong: boolean
  /** It said nothing is written; null for a question with a written reason. */
  nothing: boolean | null
}
export function proofScore(checks: readonly ProofCheck[], passed: readonly boolean[]): ProofScore {
  const of = (kind: ProofCheck['kind']) =>
    checks.flatMap((c, i) => (c.kind === kind ? [passed[i] === true] : []))
  const reasons = of('reason')
  const wrong = of('wrong').some(Boolean)
  const said = of('nothing')
  const nothing = said.length ? said.every(Boolean) : null
  const right = !wrong && (nothing === null ? reasons.every(Boolean) : nothing)
  return { right, wrong, nothing }
}

/** One way's counts in each try, one entry per try, in the order the tries were made. */
export type ProofTally = { right: number; wrong: number; nothing: number }
export type ProofArmResult = {
  arm: ProofArm
  tries: ProofTally[]
  /** Answers not made, refused, or the judge gave no usable grade: counted in no column. */
  noAnswer: number
}

/** The middle try's count: the lower of the two middles when the tries are even. */
const middle = (counts: readonly number[]) =>
  [...counts].sort((a, b) => a - b)[Math.floor((counts.length - 1) / 2)] ?? 0

/** "31 of 40 (29, 31, 33)": the middle try, out of how many, and every try beside it. */
export function scoreWords(counts: readonly number[], of: number): string {
  const spread = counts.length > 1 ? ` (${counts.join(', ')})` : ''
  return `${middle(counts)} of ${of}${spread}`
}

/**
 * The table: a row for each way, and three columns. "-" where a way cannot do what the column
 * counts: with no context there is no note to tell, and with no question where nothing is
 * written there is nothing to say.
 */
export function proofTable(
  results: readonly ProofArmResult[],
  questions: number,
  nothingQuestions: number,
  product: string,
): string[] {
  const words = proofArmWords(product)
  const head = [
    ['Right reason,', 'no wrong one'],
    ['Told a note that had', 'ended or was elsewhere'],
    ['Said nothing is', 'written when true'],
  ]
  const rows = results.map((r) => {
    const counts = (key: keyof ProofTally) => r.tries.map((t) => t[key])
    return [
      words[r.arm],
      scoreWords(counts('right'), questions),
      r.arm === 'none' ? '-' : scoreWords(counts('wrong'), questions),
      nothingQuestions ? scoreWords(counts('nothing'), nothingQuestions) : '-',
    ]
  })
  const first = Math.max(...rows.map((r) => r[0]!.length), 0) + 3
  const widths = head.map(
    (h, i) => Math.max(...h.map((w) => w.length), ...rows.map((r) => r[i + 1]!.length)) + 3,
  )
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, i) => cell.padEnd(i === 0 ? first : widths[i - 1]!))
      .join('')
      .trimEnd()
  return [
    line(['', ...head.map((h) => h[0]!)]),
    line(['', ...head.map((h) => h[1]!)]),
    ...rows.map(line),
  ]
}
