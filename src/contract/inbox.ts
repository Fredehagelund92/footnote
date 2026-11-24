/**
 * The Inbox of Footnote v1 on the API (docs/product.md, section 5): one read that joins what needs the
 * person, grouped by need (`inbox.feed`), which cards they opened
 * (`cards.markRead`), the one decision a card offers (`cards.decide`), and the setup checklist of a
 * new workspace (`setup.state`). Every count from agents is a count only, and a count under the
 * minimum reads as hidden (FR-614).
 */
import * as z from 'zod/mini'
import { alertCardRules } from '../domain/alerts.ts'
import { cardGroups, cardActions, setupSteps } from '../domain/inbox.ts'
import { familyFoundKinds } from '../domain/family-found.ts'
import { familyMeaningSources } from '../domain/family-meaning-line.ts'
import { nameFlagCodes, nameStates } from '../domain/source-names.ts'
import { raiseSubjectSchema } from './alerts.ts'
import { proposalActions } from '../domain/proposal.ts'
import { syncedSchema } from './review-path.ts'
import { undoOfferSchema } from './undo.ts'

/** A count from agents: null when it is above zero and under the minimum (FR-614). */
const shownCount = z.nullable(z.number())

const cardBase = {
  /** The card's own name, stable across reads: "proposal:<id>", "gap:<id>", "feedback:<id>", "check:<item>", "look:<domain>", "alert:<raise>", "drafts:yours". */
  id: z.string(),
  areaId: z.string(),
  /** When what it shows happened. */
  at: z.string(),
  opened: z.boolean(),
  /** Decided or closed, with how and when; null while it needs someone. */
  done: z.nullable(z.object({ outcome: z.string(), at: z.string() })),
}

/**
 * One card, by what happened (the Inbox's groups: Names, Not found, Reported, Saved questions,
 * Alerts, Mentioned you, Due for a check, Suggestions, Your drafts).
 */
export const cardSchema = z.union([
  z.object({
    ...cardBase,
    group: z.literal('names'),
    /** The domain of the names, when they share one: names can belong to none (CON-206). */
    areaId: z.nullable(z.string()),
    /** The names Accept all takes, the ones that need a look first, and the tools that gave them. */
    ready: z.number(),
    flagged: z.number(),
    /** Of the names that wait, the families of near-identical metrics (FR-142). */
    families: z.number(),
    tools: z.array(z.string()),
  }),
  z.object({
    ...cardBase,
    group: z.literal('suggestion'),
    proposalId: z.string(),
    number: z.number(),
    title: z.string(),
    action: z.enum(proposalActions),
    itemId: z.nullable(z.string()),
    /** Who sent it; null when a content source's read made it, which `synced` names. */
    from: z.nullable(z.object({ personId: z.string(), name: z.nullable(z.string()) })),
    writtenBy: z.nullable(z.enum(['agent', 'source'])),
    /** The agent that sent it, by its name then (FR-420); null for anything an agent didn't send. */
    agent: z.nullable(z.string()),
    synced: z.nullable(syncedSchema),
    /** The person read the version under review: it may go out with the others they read (FR-226). */
    read: z.boolean(),
    /** What needs care before publishing: claims to check, and whether it clashes with live context. */
    care: z.object({ claims: z.number(), clash: z.boolean() }),
  }),
  z.object({
    ...cardBase,
    group: z.literal('gap'),
    gapId: z.string(),
    ref: z.string(),
    /** What agents asked about, in words: never their words, which are not kept. */
    title: z.string(),
    scope: z.object({
      metrics: z.array(z.string()),
      values: z.array(z.string()),
      dimensions: z.array(z.string()),
      month: z.nullable(z.string()),
    }),
    /** How often agents found nothing for it this week. */
    times: shownCount,
    /**
     * How often people said this week that it is missing, with Tell the owner in Ask: the card
     * reaches only those who manage the gap, who see its reports in full.
     */
    told: z.number(),
    /** The draft started from it, if any. */
    draft: z.nullable(z.string()),
  }),
  z.object({
    ...cardBase,
    group: z.literal('flag'),
    /** What it was sent as: an agent's anonymous feedback, or a person's named report from Ask. */
    source: z.enum(['agent', 'ask']),
    /** The record behind it: the feedback's id, or the named report's. */
    feedbackId: z.string(),
    verdict: z.enum(['wrong', 'unclear']),
    note: z.nullable(z.string()),
    /** Who sent a named report; null for an agent's feedback, which keeps nobody. */
    by: z.nullable(z.string()),
    /** A named report's question, correct version and link, as its sender wrote them. */
    question: z.nullable(z.string()),
    correction: z.nullable(z.string()),
    link: z.nullable(z.string()),
    /** The context the reported answer gave, as agents got it, first first; empty when unknown. */
    items: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  z.object({
    ...cardBase,
    group: z.literal('mention'),
    /** The thread, as the app names it: "review:<suggestion id>" or "context:<item id>". */
    subject: z.string(),
    /** What the thread hangs on: the suggestion's or the item's title. */
    title: z.string(),
    /** The newest comment there that mentions the person and that they haven't read. */
    commentId: z.string(),
    from: z.object({ personId: z.string(), name: z.nullable(z.string()) }),
    excerpt: z.string(),
  }),
  z.object({
    ...cardBase,
    group: z.literal('look'),
    /** The domain's saved questions that need a look now, the newest to need one first (FR-526). */
    questions: z.array(z.object({ id: z.string(), question: z.string() })),
  }),
  z.object({
    ...cardBase,
    group: z.literal('alert'),
    /** The raise behind it, and the rule that raised it. */
    raiseId: z.string(),
    rule: z.enum(alertCardRules),
    /** What the rule found, in counts and scopes only (FR-614). */
    title: z.string(),
    /** Where its one action goes: a topic's answer panel, a page, or an integration. */
    subject: raiseSubjectSchema,
  }),
  z.object({
    ...cardBase,
    group: z.literal('drafts'),
    /** The domain of the drafts, when they share one. */
    areaId: z.nullable(z.string()),
    /**
     * The person's own drafts that wait for them, oldest first (FR-139): each one imported, or not
     * saved for DRAFT_OLD_DAYS days. Only they can see them; they send or publish them all at once.
     */
    drafts: z.array(z.object({ id: z.string(), areaId: z.string(), imported: z.boolean() })),
  }),
  z.object({
    ...cardBase,
    group: z.literal('check'),
    itemId: z.string(),
    title: z.string(),
    /**
     * Its check date passed, a definition it relies on changed at its source, or a family of
     * metrics it is about was split back into its metrics (FR-142).
     */
    reason: z.enum(['date', 'source', 'family']),
    /** The definitions that changed at their source since the item was checked, with the day each changed; empty for a date. */
    changed: z.array(z.object({ name: z.string(), on: z.string() })),
    /**
     * The families it is about that were split, each with the metrics it still reaches agents
     * through, by name; empty for any other reason.
     */
    families: z.array(z.object({ name: z.string(), metrics: z.array(z.string()) })),
    lastChecked: z.object({ on: z.nullable(z.string()), by: z.nullable(z.string()) }),
  }),
])
export type Card = z.infer<typeof cardSchema>

/**
 * A suggestion the person sent that waits on an owner, that an owner returned to them, or that an
 * owner closed in the last two weeks.
 */
export const waitingSchema = z.object({
  proposalId: z.string(),
  title: z.string(),
  areaId: z.nullable(z.string()),
  sentAt: z.nullable(z.string()),
  waitingFor: z.array(z.string()),
  /**
   * Returned with a note, by whom and when: it waits on the person, who edits it and sends it
   * again. The note is the first comment of its discussion. Null while it waits on an owner.
   */
  returned: z.nullable(z.object({ by: z.nullable(z.string()), at: z.string() })),
  /**
   * Closed by an owner, who said why: it is not published. `read` once the person opened it in
   * their Inbox (card `closed:<proposal id>`). Null for anything else.
   */
  closed: z.nullable(
    z.object({ by: z.nullable(z.string()), at: z.string(), reason: z.string(), read: z.boolean() }),
  ),
})

export const feedInputSchema = z.object({
  /** Needs me (the default), or All: also what waits on others and what is done. */
  tab: z.optional(z.enum(['needs', 'all'])),
})
export const feedSchema = z.object({
  /**
   * This week's questions from agents, counts only: no words, no names. The same count as Ask's
   * Asked this week, over the same last 7 full days and as this person may have it.
   */
  week: z.object({
    asked: shownCount,
    /** What Asked this week's rows show together: "143+" when `asked` is null. */
    askedAtLeast: z.number(),
    found: shownCount,
    nothing: shownCount,
    /** What most questions that found nothing were about, in words; null when under the minimum. */
    mostAbout: z.nullable(z.string()),
  }),
  groups: z.array(z.object({ group: z.enum(cardGroups), count: z.number() })),
  cards: z.array(cardSchema),
  waiting: z.array(waitingSchema),
})
export type Feed = z.infer<typeof feedSchema>

export const cardIdSchema = z.string().check(z.regex(/^[a-z]+:[A-Za-z0-9_.:-]{1,80}$/))
export const markCardsReadSchema = z.strictObject({
  cards: z.array(cardIdSchema).check(z.minLength(1), z.maxLength(100)),
})

export const decideCardSchema = z.strictObject({
  card: cardIdSchema,
  action: z.enum(cardActions),
  reason: z.optional(z.string().check(z.minLength(1), z.maxLength(500))),
})
export const decideCardResultSchema = z.object({
  /** The edition the decision published, if it published one (Still true, Archive). */
  edition: z.nullable(z.string()),
  undo: undoOfferSchema,
})

/** A name a read made (FR-141): what it would be, and whether it needs a look first. */
export const sourceNameSchema = z.object({
  /** The vocabulary key it takes. */
  key: z.string(),
  /** A metric, a dimension, or a family of metrics that goes live with its variants (FR-142). */
  kind: z.enum(['metric', 'dimension', 'metric_group']),
  name: z.string(),
  aliases: z.array(z.string()),
  /** The members it links once accepted, and those a live term links already. */
  definitionRefs: z.array(z.string()),
  linked: z.array(z.string()),
  areaId: z.nullable(z.string()),
  /** The source's description, as a copy (CON-207). */
  description: z.nullable(z.string()),
  /** The tool that gave it, as people say it ("dbt"). */
  tool: z.string(),
  /** The source that read it, by its id in Integrations: its page counts its families. */
  source: z.string(),
  state: z.enum(nameStates),
  flags: z.array(z.object({ code: z.enum(nameFlagCodes), message: z.string() })),
  /** An owner left it out; otherwise it is a date or an id, which stay out by themselves. */
  leftByOwner: z.boolean(),
  /**
   * A family's variants, counted, what tells them apart in words (["Currency", "Channel"]), and how
   * it was found (D1, D6): declared in the tool, found from the calculation, found from a rate, or
   * suggested by the names alone. They go live with it, and are never listed one by one, but for a family the names alone
   * suggest: its variants' names (`names`), as the owner publishes them as one family or apart.
   * Null for any other name.
   */
  family: z.nullable(
    z.object({
      variants: z.number(),
      by: z.array(z.string()),
      found: z.enum(familyFoundKinds),
      /** The variants' names, of a family the names alone suggest; empty for any other. */
      names: z.array(z.string()),
      /** The values its variants hold for each of `by`, each once: `[["EUR", "USD"], ["web"]]`. */
      values: z.array(z.array(z.string())),
      /**
       * What it would mean once published (M1), as the catalogue works it out from its variants'
       * own words: their common words, each value as the axis it stands for ("in {Currency}"), or
       * none. `agree` counts the variants that share them, `differing` those that say otherwise.
       * Null for a family already live, whose meaning its page gives.
       */
      meaning: z.nullable(
        z.object({
          source: z.enum(familyMeaningSources),
          words: z.nullable(z.string()),
          agree: z.number(),
          /** The variant the others are converted from, as the card shows variants; else null. */
          base: z.nullable(z.string()),
          differing: z.number(),
        }),
      ),
    }),
  ),
})
export type SourceNameRead = z.infer<typeof sourceNameSchema>

export const namesSchema = z.object({
  /** The names as the person read them: a decision on an older list is refused. */
  revision: z.string(),
  names: z.array(sourceNameSchema),
})
export type NamesRead = z.infer<typeof namesSchema>

/** The most names one decision takes: a whole model, as a read gives it. */
export const NAMES_MAX = 20_000

const nameKeySchema = z.string().check(z.regex(/^(?:metric|dim|group):[a-z0-9_]+$/))
export const decideNamesSchema = z.strictObject({
  revision: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  /** The names to make live: `name` only when the person changed it. */
  accept: z
    .array(
      z.strictObject({
        key: nameKeySchema,
        name: z.optional(z.string().check(z.minLength(1), z.maxLength(200))),
        /**
         * A family Footnote suggests, published apart (Keep them separate): each of its variants
         * by its own name, and no family. Never a family its tool declares, nor one live already.
         */
        apart: z.optional(z.literal(true)),
      }),
    )
    .check(z.maxLength(NAMES_MAX)),
  leaveOut: z.array(nameKeySchema).check(z.maxLength(NAMES_MAX)),
})
export type DecideNames = z.infer<typeof decideNamesSchema>
export const decideNamesResultSchema = z.object({
  /** The edition that made them live; null when nothing was accepted. */
  edition: z.nullable(z.string()),
  accepted: z.number(),
  leftOut: z.number(),
  /**
   * The names that wait after the decision, as `names` reads them: an owner decides one name
   * after another, and the card shows the next list without reading it again.
   */
  waiting: namesSchema,
})
export type NamesDecision = z.infer<typeof decideNamesResultSchema>

export const setupSchema = z.object({
  steps: z.array(z.object({ id: z.enum(setupSteps), done: z.boolean() })),
  done: z.boolean(),
  /**
   * The definitions the server's own configuration reads, such as a model folder: the source's id
   * and where its read stands: still on its way, read, or ended without a good read. Null when the
   * server reads none, and the definitions step offers to connect a tool.
   */
  serverSource: z.nullable(
    z.object({ id: z.string(), state: z.enum(['reading', 'read', 'failed']) }),
  ),
})
export type Setup = z.infer<typeof setupSchema>
