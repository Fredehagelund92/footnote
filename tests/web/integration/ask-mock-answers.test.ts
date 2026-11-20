import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LoopTurn } from '@contract/answer'
import { mockQuestions } from '@/api/mock/data/ask'
import { facts } from '@/api/mock/data/world'
import { serverItemId } from '../http/demo-week.ts'
import { askWorld } from './ask-world.ts'

/*
  The mock's Ask answers (src/web/api/mock/data/loop-answers.json): each question the mock offers
  or seeds, asked on the demo week through the real service with no model key, so the scripted
  reader answers, as the keyless demo does. With LOOP_ANSWERS_OUT set, the turns are written there,
  by question, with each item by the mock's own id, so a citation opens the mock's item. Every
  question must come back as an answer the reader made, never one that stopped.
*/

const ML = 'Maria Lindqvist'
const world = askWorld()
/** The mock's id of each item the demo week holds. */
const mockIds = new Map(facts.map((f) => [serverItemId(f.id), f.id]))

describe("the mock's Ask answers", () => {
  const turns: Record<string, LoopTurn> = {}

  it.each(mockQuestions)('answers %s with the scripted reader', async (question) => {
    const api = await world.as(ML)
    const a = await api.ask({ question })
    expect(a.loop?.kind).not.toBe('stopped')
    turns[question] = a.loop!
  })

  it('writes the answers the mock gives, when asked to', () => {
    const out = process.env.LOOP_ANSWERS_OUT
    if (!out) return
    const json = JSON.stringify(turns, null, 2).replace(
      /\bitm_[a-z0-9]+\b/g,
      (id) => mockIds.get(id) ?? id,
    )
    writeFileSync(out, `${json}\n`)
  })
})
