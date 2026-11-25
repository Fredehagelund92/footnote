import { describe, expect, it } from 'vitest'
import { UTC_CALENDAR } from '../../src/domain/dates.ts'
import { proofChecks, proofScore, type ProofQuestion } from '../../src/domain/proof.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { Queryable } from '../../src/server/db/database.ts'
import { toolNames } from '../../src/server/mcp/tools.ts'
import { answerQuestion, judgeAnswer } from '../../src/server/modules/evals/answer.ts'
import { openArm } from '../../src/server/modules/evals/arm.ts'
import { proofSystemPrompt } from '../../src/server/modules/evals/proof.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { withOrderShare } from './mcp/fixtures.ts'

/*
  The built-from lab end to end, as the proof's Footnote ways ask: the scripted agent calls
  get_context through the real MCP wire (openArm), answers from the reply, and the scripted judge
  grades the answer against the question's reason. Off, the reason is on a metric the asked one is
  built from and is never told; on, it is told under its own label and graded as the reason.
*/

/** The eval client's policy, and nothing else the database holds. */
const database: Queryable = {
  query: <Row>(sql: string) =>
    Promise.resolve(
      (sql.includes('client_policies')
        ? [
            {
              client_label: 'eval',
              tools_allowed: null,
              rate_per_minute: null,
              max_response_bytes: null,
              enabled: true,
            },
          ]
        : []) as Row[],
    ),
}
const port = createModelPort({ mode: 'mock' })
const asOf = '2026-08-20'
const question: ProofQuestion = {
  id: 'order-share-norway-august',
  as_of: asOf,
  question: 'Order share Norway August 2026',
  reasons: ['itm_norway01'],
  wrong: [],
}

async function asked(builtFrom: boolean) {
  const bundle = withOrderShare()
  const arm = await openArm(
    bundle,
    database,
    systemClock(asOf),
    { tools: [...toolNames], about: '', calendar: UTC_CALENDAR },
    { builtFrom },
  )
  try {
    const answer = await answerQuestion(
      arm,
      port.choose('eval_answer'),
      question.question,
      undefined,
      proofSystemPrompt(asOf),
    )
    const { checks, rubrics } = proofChecks(
      question,
      new Map(bundle.items.map((item) => [item.id, item])),
    )
    const judged = await judgeAnswer(
      port.choose('judge'),
      {
        expected: {
          must_deliver: [],
          must_not_deliver: [],
          no_cause_claim: false,
          clarifying_question: false,
        },
        rubrics,
      },
      answer.answer,
    )
    if (judged.kind === 'refused') throw new Error('The scripted judge refused')
    const passed = new Map(judged.verdict.rubrics.map((r) => [r.id, r.passed]))
    return {
      answer: answer.answer,
      score: proofScore(
        checks,
        rubrics.map((_, i) => passed.get(`rubric_${i + 1}`) === true),
      ),
    }
  } finally {
    await arm.close()
  }
}

describe('the built-from lab through the proof', () => {
  it('tells and is credited with the reason on a metric the asked one is built from', async () => {
    const off = await asked(false)
    expect(off.answer).not.toContain('Norway closure')
    expect(off.score).toEqual({ right: false, wrong: false, nothing: null })
    const on = await asked(true)
    expect(on.answer).toContain('Built from: Order share is built from Orders')
    expect(on.answer).toContain('Norway closure')
    expect(on.score).toEqual({ right: true, wrong: false, nothing: null })
  }, 60_000)
})
