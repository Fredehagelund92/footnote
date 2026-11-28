import { writeFileSync } from 'node:fs'
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FootnoteApi } from '@/api/client'
import type { Fact } from '@/model/items'
import {
  scriptedLoopChoice,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../../src/server/modules/answer/index.ts'
import {
  createModelPort,
  type ModelChoice,
  type ModelPort,
  type ModelRef,
  type ModelRole,
} from '../../../src/server/modules/models/index.ts'
import { PageReadError, type PageReader } from '../../../src/server/modules/web/index.ts'
import { helpCases, type Fields, type HelpCase } from '../writing-help-eval/cases.ts'
import { grade, report, type HelpRun, type PeopleFields } from '../writing-help-eval/graders.ts'
import { askWorld } from './ask-world.ts'

/*
  Writing help's drafting evaluation (docs/evaluations.md): each case is one turn of writing help
  on a draft of its person's, on the demo week, through the real service, sign-in and row security
  and the browser's own binding, graded on the draft as the person then reads it.

  In every build the model is a scripted writer that passes write_draft each case's careful answer
  and, where the case has one, a careless one before it: the build proves every case can be met
  through the write path and that its checks hold whatever is written, so no promise may break
  and no field be missed. With WRITING_HELP_EVAL_REAL=1 (`npm run eval:writing-help -- --real`) a
  real model writes, stopping before WRITING_HELP_EVAL_MAX_MICROS is spent, and the report says
  how well it drafts: it asserts nothing.
*/

const real = process.env.WRITING_HELP_EVAL_REAL === '1'
const tries = Number(process.env.WRITING_HELP_EVAL_TRIES ?? 1)
const ceiling = Number(process.env.WRITING_HELP_EVAL_MAX_MICROS ?? 0)
const only = process.env.WRITING_HELP_EVAL_CASES?.split(',').filter(Boolean)
const out = process.env.WRITING_HELP_EVAL_OUT
const MODEL: ModelRef = process.env.WRITING_HELP_EVAL_MODEL
  ? (JSON.parse(process.env.WRITING_HELP_EVAL_MODEL) as ModelRef)
  : { provider: 'vercel-gateway', model: 'anthropic/claude-haiku-5.5' }

/** A member who owns no domain writes, unless a case names someone. */
const WRITER = 'Maria Lindqvist'

const cases = helpCases.filter((c) => !only || only.includes(c.id))
let current: HelpCase = cases[0]!

/** The links a turn opened, and the pages of the cases' links. */
let opened: string[] = []
const pages = new Map(helpCases.flatMap((c) => (c.page ? [[c.page.url, c.page] as const] : [])))
const readPage: PageReader = (address) => {
  opened.push(address)
  const page = pages.get(address)
  if (!page) return Promise.reject(new PageReadError('unreachable'))
  return Promise.resolve({
    url: address,
    finalUrl: address,
    contentType: 'text/html',
    charset: 'utf-8',
    bytes: 2_000,
    title: page.title,
    paragraphs: page.paragraphs,
  })
}

/**
 * What the person changes while writing help works: made once, as the model is first asked, after
 * the turn read the draft and before any field it writes lands.
 */
let meanwhile: (() => Promise<void>) | null = null
const personFirst: LanguageModelMiddleware = {
  wrapStream: async ({ doStream }) => {
    const change = meanwhile
    meanwhile = null
    await change?.()
    return doStream()
  },
}
const withPersonFirst = (choice: ModelChoice): ModelChoice => ({
  ...choice,
  model: wrapLanguageModel({ model: choice.model, middleware: personFirst }),
})

/**
 * The scripted writer: the case's careless call first, which the checks refuse, then its careful
 * answer, as a model that is told why does; then a reply, with the case's question when it has one.
 */
function writerStep(prompt: ScriptedPrompt): ScriptedStep {
  const writes = [current.careless, current.written].filter((w) => w !== undefined)
  const done = prompt.results.filter((r) => r.toolName === 'write_draft').length
  if (done < writes.length) return { calls: [{ toolName: 'write_draft', input: writes[done]! }] }
  return {
    text: 'I wrote the draft from your message. Check each field.',
    ...(current.question ? { calls: [{ toolName: 'ask_person', input: current.question }] } : {}),
  }
}

const live: ModelPort | undefined = real
  ? (() => {
      const port = createModelPort({ mode: 'live', env: process.env })
      return {
        ...port,
        choose: (role: ModelRole, ref?: ModelRef) => withPersonFirst(port.choose(role, ref)),
      }
    })()
  : undefined
const world = askWorld({
  ...(live
    ? { models: live, assistant: MODEL }
    : { writingHelpModel: withPersonFirst(scriptedLoopChoice('writer', writerStep)) }),
  readPage,
})

/** A new draft as the editor starts one, with what the person wrote before the turn. */
function factOf(before: Fields = {}): Fact {
  return {
    id: 'new',
    title: before.title ?? '',
    summary: before.text ?? '',
    domain: 'area_sales',
    kind: before.kind ?? 'event',
    where: before.where ?? [],
    valid: {
      ...(before.from ? { from: before.from } : {}),
      ...(before.until ? { until: before.until } : {}),
    },
    when: '',
    status: 'Draft',
    checkedBy: '',
    checkedOn: '',
    source: before.source ?? '',
    quote: '',
    dontConclude: before.dontConclude ?? '',
  }
}

/** The fields a person changes, over the draft as the editor holds it. */
const changed = (fact: Fact, to: Fields): Fact => ({
  ...fact,
  ...(to.title !== undefined ? { title: to.title } : {}),
  ...(to.text !== undefined ? { summary: to.text, body: '' } : {}),
  ...(to.from !== undefined ? { valid: { ...fact.valid, from: to.from } } : {}),
  ...(to.dontConclude !== undefined ? { dontConclude: to.dontConclude } : {}),
})

/** The draft as the person reads it. */
const fieldsOf = (fact: Fact): Fields => ({
  title: fact.title,
  text: [fact.summary, fact.body].filter(Boolean).join('\n\n'),
  kind: fact.kind,
  where: fact.where,
  ...(fact.valid.from ? { from: fact.valid.from } : {}),
  ...(fact.valid.until ? { until: fact.valid.until } : {}),
  ...(fact.source ? { source: fact.source } : {}),
  ...(fact.dontConclude ? { dontConclude: fact.dontConclude } : {}),
})

/** The fields only people decide, and whether it is still a draft, as stored. */
async function stored(id: string) {
  const { rows } = await world.client.query<{ draft: Record<string, unknown>; state: string }>(
    'select draft, state from proposals where id = $1',
    [id],
  )
  const draft = rows[0]?.draft ?? {}
  const people: PeopleFields = {
    areaId: draft.areaId,
    ownerId: draft.ownerId,
    audience: draft.audience,
    riskLevel: draft.riskLevel,
    claimLevel: draft.claimLevel,
  }
  const evidence = (draft.evidence as { quote?: string }[] | undefined) ?? []
  return { people, state: rows[0]?.state, quote: evidence[0]?.quote ?? '' }
}

/** What the service's meter has spent since the run began, in micros. */
let spentAtStart: number | undefined
async function spent() {
  const { rows } = await world.client.query<{ micros: string }>(
    'select coalesce(sum(cost_micros), 0) as micros from llm_spend_monthly',
  )
  spentAtStart ??= Number(rows[0]!.micros)
  return Number(rows[0]!.micros) - spentAtStart
}

/** One turn on one case, as its person: the draft before, the turn, the draft after. */
async function runCase(c: HelpCase): Promise<HelpRun> {
  current = c
  const api: FootnoteApi = await world.as(c.as ?? WRITER)
  const { id } = await api.startWritingHelp({ fact: factOf(c.before), isNew: true })
  const before = await stored(id)
  opened = []
  meanwhile = c.meanwhile
    ? async () => {
        const now = (await api.draftNow({ id }))!
        await api.autosaveDraft({
          fact: changed(now, c.meanwhile!),
          before: now,
          revision: now.session!.revision,
        })
      }
    : null
  const reply = await api
    .writingHelp({ draftId: id, message: c.message, ...(c.turns ? { turns: c.turns } : {}) })
    .catch(() => null)
  meanwhile = null
  const after = await api.draftNow({ id })
  const now = await stored(id)
  return {
    case: c,
    reply,
    after: after ? fieldsOf(after) : {},
    draft: !!after && now.state === 'draft',
    people: { before: before.people, after: now.people },
    opened: [...opened],
    quote: now.quote,
  }
}

const pageText = (c: HelpCase) => c.page?.paragraphs.join('\n\n') ?? ''

describe("writing help's drafting evaluation", () => {
  beforeAll(async () => {
    // On, as an admin turns it on, and the daily turns are not what this measures.
    for (const [key, value] of [
      ['writing_help.on', true],
      ['limits.writing_help', { turns_per_day: 100_000, paste_characters: 12_000 }],
    ] as const)
      await world.client.query(
        `insert into settings_versions (key, version, value, reason)
         select $1, coalesce(max(version), 0) + 1, $2::jsonb, 'writing help eval'
           from settings_versions where key = $1`,
        [key, JSON.stringify(value)],
      )
  })

  it(
    'drafts every case, keeping every promise',
    async () => {
      if (real && !ceiling) throw new Error('A real run needs WRITING_HELP_EVAL_MAX_MICROS.')
      const runs: HelpRun[] = []
      let incomplete = false
      for (const c of cases)
        for (let t = 0; t < (real ? tries : 1); t++) {
          if (real && (await spent()) >= ceiling) {
            incomplete = true
            break
          }
          runs.push(await runCase(c))
        }
      const graded = runs.map((run) => grade(run, pageText(run.case)))
      const answered = runs.filter((r) => r.reply && r.reply.stopped === null)
      const result = report(graded, {
        asked: answered.filter((r) => r.reply!.question).length,
        of: answered.length,
      })
      const micros = real ? await spent() : 0
      const text = `${result.text}${real ? `\nSpent ${(micros / 1e6).toFixed(4)} USD by the service's meter${incomplete ? '. Stopped at the ceiling: the run is incomplete' : ''}.` : ''}`
      console.log(`\n${text}`)
      if (out)
        writeFileSync(
          out,
          JSON.stringify(
            {
              text,
              model: real ? MODEL : 'scripted',
              spentMicros: micros,
              incomplete,
              report: result,
              runs: runs.map((r, i) => ({
                id: r.case.id,
                reply: r.reply,
                after: r.after,
                opened: r.opened,
                graded: graded[i],
              })),
            },
            null,
            2,
          ),
        )
      if (real) return
      // The scripted writer's answers meet every case, and nothing it writes breaks a promise.
      expect(result.unanswered).toEqual([])
      expect(result.broken).toEqual({})
      expect(result.missed).toEqual({})
    },
    real ? 3_600_000 : 600_000,
  )
})
