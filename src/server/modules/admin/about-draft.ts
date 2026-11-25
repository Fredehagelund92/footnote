import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { ORPCError } from '@orpc/client'
import { generateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import {
  ABOUT_DRAFT_INSTRUCTIONS,
  ABOUT_FACTS_LIMITS,
  aboutByRule,
  aboutDraftOf,
  aboutFactsIn,
  aboutFactsMessage,
  type AboutFacts,
} from '../../../domain/about-business.ts'
import type { Database, Queryable } from '../../db/database.ts'
import {
  conversationRetry,
  costMicros,
  createCallMeter,
  spendLimitReached,
  type ModelChoice,
  type SpendLimits,
} from '../models/index.ts'

/*
  Write a first version for me (domain/about-business.ts): About our business drafted from what
  the install holds, for an administrator to change before they keep it. The facts are read in a
  short transaction as the person, the model is asked with no connection held, and nothing is
  written but the call's cost: the text goes back to the editor and is saved only when kept.
*/

/** Enough for 500 characters of text. */
const DRAFT_MAX_TOKENS = 400

const cut = (text: string | null) =>
  text ? [...text.trim()].slice(0, ABOUT_FACTS_LIMITS.description).join('') : null

/**
 * The domains, the live metrics with what their definitions say, and the live dimensions with
 * their values, as the person reads them. The sandbox is not the business, and a definition the
 * source limits to groups is left out.
 */
export async function readAboutFacts(tx: Queryable): Promise<AboutFacts> {
  const domains = await tx.query<{ name: string; description: string }>(
    `select name, coalesce(nullif(summary, ''), description) as description
       from areas where archived_at is null and not is_demo order by name limit $1`,
    [ABOUT_FACTS_LIMITS.domains],
  )
  const metrics = await tx.query<{ name: string; description: string | null }>(
    `select t.name,
            (select d.description_copy from definitions d
              where d.ref = any(t.definition_refs) and d.visible_groups is null
                and d.description_copy is not null and d.description_copy <> ''
              order by d.ref limit 1) as description
       from serving_vocabulary((select seq from live_edition)) t
      where t.kind = 'metric' order by t.name limit $1`,
    [ABOUT_FACTS_LIMITS.metrics],
  )
  const dimensions = await tx.query<{ name: string; values: string[] }>(
    `select d.name,
            coalesce((select array_agg(v.name order by v.name) from (
               select v.name from serving_vocabulary((select seq from live_edition)) v
                where v.kind = 'dimension_value' and v.parent_key = d.key
                order by v.name limit $2) v), '{}') as values
       from serving_vocabulary((select seq from live_edition)) d
      where d.kind = 'dimension' order by d.name limit $1`,
    [ABOUT_FACTS_LIMITS.dimensions, ABOUT_FACTS_LIMITS.values],
  )
  return {
    domains: domains.map((d) => ({ name: d.name, description: cut(d.description) ?? '' })),
    metrics: metrics.map((m) => ({ name: m.name, description: cut(m.description) })),
    dimensions,
  }
}

/** Whether the facts hold anything to write from. */
const holdsAnything = (facts: AboutFacts) =>
  facts.domains.length > 0 ||
  facts.metrics.length > 0 ||
  facts.dimensions.some((d) => d.values.length > 0)

/** The scripted drafter the service runs on the mock (MODELS=mock): the rule, no model. */
export function scriptedAboutModel(): ModelChoice {
  const model = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'scripted-about',
    doGenerate: (options: LanguageModelV4CallOptions) => {
      const sent = options.prompt
        .flatMap((m) =>
          m.role === 'user' ? m.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])) : [],
        )
        .join('\n')
      const facts = aboutFactsIn(sent)
      const text = facts ? aboutByRule(facts) : ''
      const tokens = (t: string) => Math.max(1, Math.ceil(t.length / 4))
      return Promise.resolve({
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: tokens(sent), noCache: tokens(sent), cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: tokens(text), text: tokens(text), reasoning: 0 },
        },
        warnings: [],
      })
    },
  })
  return {
    model,
    options: {},
    cacheBreakpoint: {},
    id: 'mock/scripted-about',
    provider: 'mock',
    name: 'scripted-about',
    vendor: 'mock',
    family: 'mock/scripted-about',
    effort: 'none',
    prices: { input: 0, output: 0, cacheRead: 0 },
    recipients: 'nobody: the scripted mock runs on this machine',
  }
}

/**
 * A first version from the facts, by the model given. Null limits leave the call unmetered, as
 * the scripted mock is; with limits it is refused before it is sent when it would pass one, and
 * its cost counts as Ask's, for the person.
 */
export async function draftAbout(deps: {
  database: Database
  person: string
  facts: AboutFacts
  model: ModelChoice
  limits: SpendLimits | null
  onError?: (error: unknown) => void
}): Promise<string> {
  if (!holdsAnything(deps.facts))
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message:
        'There is nothing to write from yet. Add a domain or connect your definitions, or write the text yourself.',
    })
  const prompt = aboutFactsMessage(deps.facts)
  if (deps.limits) {
    const next = costMicros(deps.model.prices, {
      inputTokens: Math.ceil((ABOUT_DRAFT_INSTRUCTIONS.length + prompt.length) / 4),
      outputTokens: DRAFT_MAX_TOKENS,
      cacheReadTokens: 0,
    })
    const stop = await deps.database.transaction(deps.person, (tx) =>
      spendLimitReached(tx, 'assistant', deps.limits!, next, deps.person),
    )
    if (stop) throw new ORPCError('UNPROCESSABLE_CONTENT', { message: stop.message })
  }
  const meter = deps.limits
    ? createCallMeter({
        database: deps.database,
        feature: 'assistant',
        person: deps.person,
        limits: null,
        retry: conversationRetry,
        ...(deps.onError ? { onRecordError: deps.onError } : {}),
      })
    : null
  const choice = meter ? meter.wrap(deps.model, { role: 'assistant' }) : deps.model
  let text: string
  try {
    const result = await generateText({
      model: choice.model,
      providerOptions: choice.options,
      instructions: ABOUT_DRAFT_INSTRUCTIONS,
      prompt,
      maxOutputTokens: DRAFT_MAX_TOKENS,
      // The model call meter retries what is worth retrying.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(30_000),
    })
    text = aboutDraftOf(result.text)
  } catch (error) {
    deps.onError?.(error)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'A first version could not be written just now. Try again, or write it yourself.',
    })
  } finally {
    await meter?.close()
  }
  if (!text)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'A first version could not be written. Write the text yourself.',
    })
  return text
}
