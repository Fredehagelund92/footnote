import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import {
  ABOUT_DRAFT_INSTRUCTIONS,
  aboutByRule,
  aboutFactsIn,
  type AboutFacts,
} from '../../src/domain/about-business.ts'
import type { Database } from '../../src/server/db/database.ts'
import { draftAbout, scriptedAboutModel } from '../../src/server/modules/admin/about-draft.ts'
import type { ModelChoice } from '../../src/server/modules/models/index.ts'

/*
  Write a first version for me on the service: what the model is sent, what the editor gets back,
  and the refusals. Unmetered (no limits), so no database is reached.
*/

const facts: AboutFacts = {
  domains: [{ name: 'Sales', description: 'Orders and what customers pay.' }],
  metrics: [{ name: 'Orders', description: 'Completed and paid orders.' }],
}
const noDatabase = {} as Database

/** A model that answers `reply`, or fails, and keeps what it was sent. */
function modelOf(reply: string | Error) {
  const sent: LanguageModelV4CallOptions[] = []
  const model = new MockLanguageModelV4({
    doGenerate: (options) => {
      sent.push(options)
      if (reply instanceof Error) return Promise.reject(reply)
      return Promise.resolve({
        content: [{ type: 'text', text: reply }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      })
    },
  })
  const choice: ModelChoice = { ...scriptedAboutModel(), model, id: 'mock/test', name: 'test' }
  return { choice, sent }
}

const draft = (model: ModelChoice, given: AboutFacts = facts) =>
  draftAbout({ database: noDatabase, person: 'p1', facts: given, model, limits: null })

describe('a first version of About our business', () => {
  it('sends the model its instructions and the facts, and gives back its text cleaned', async () => {
    const { choice, sent } = modelOf('"We sell outdoor gear in Germany and Norway."')
    expect(await draft(choice)).toBe('We sell outdoor gear in Germany and Norway.')
    const [call] = sent
    const system = call!.prompt.find((m) => m.role === 'system')
    expect(system?.content).toBe(ABOUT_DRAFT_INSTRUCTIONS)
    const user = call!.prompt.find((m) => m.role === 'user')
    const text =
      user?.role === 'user' && user.content[0]?.type === 'text' ? user.content[0].text : ''
    expect(aboutFactsIn(text)).toEqual(facts)
  })

  it('is written by rule on the scripted mock', async () => {
    expect(await draft(scriptedAboutModel())).toBe(aboutByRule(facts))
  })

  it('is refused when there is nothing to write from', async () => {
    const { choice, sent } = modelOf('Anything.')
    await expect(draft(choice, { domains: [], metrics: [] })).rejects.toThrow(
      /nothing to write from yet/,
    )
    expect(sent).toHaveLength(0)
  })

  it('says so when the model fails or writes nothing', async () => {
    await expect(draft(modelOf(new Error('down')).choice)).rejects.toThrow(
      /could not be written just now/,
    )
    await expect(draft(modelOf('  ').choice)).rejects.toThrow(/Write the text yourself/)
  })
})
