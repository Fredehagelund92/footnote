/**
 * Alerts on the API (FR-621): the eight rules, each on or off with its threshold and the domains
 * the person muted it for (`alerts.rules`); an administrator turns one on or off and sets its
 * threshold (`alerts.setRule`); an owner mutes one for domains they own (`alerts.mute`); and what
 * the rules raised lately, newest first, as the person may read it (`alerts.raised`). A raise is a
 * card in the Inbox, never an email. The rules and their words are in src/domain/alerts.ts.
 */
import * as z from 'zod/mini'
import { alertAudiences, alertRuleIds } from '../domain/alerts.ts'

const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))

/** Where a raise sends people: the card it raised, a topic's answer panel, a page, an integration. */
export const raiseSubjectSchema = z.union([
  z.object({ card: z.string() }),
  z.object({ topic: z.string(), pair: z.optional(z.string()) }),
  z.object({ page: z.enum(['overview', 'usage']) }),
  z.object({ connector: z.string() }),
])

/** One raise: what it was about in words (counts and scopes only), when, and whom it reached. */
export const alertRaiseSchema = z.object({
  id: z.string(),
  rule: z.enum(alertRuleIds),
  /** The domains it is about; none for a rule about the whole workspace. */
  areaIds: z.array(z.string()),
  title: z.string(),
  subject: raiseSubjectSchema,
  raisedAt: z.string(),
  /** Who its card reached, by name; empty until it is delivered. */
  reached: z.array(z.string()),
})
export type AlertRaise = z.infer<typeof alertRaiseSchema>

export const alertRuleRecordSchema = z.object({
  rule: z.enum(alertRuleIds),
  enabled: z.boolean(),
  /** What it fires at; null for a rule with no threshold. */
  threshold: z.nullable(z.number()),
  audience: z.enum(alertAudiences),
  /** The domains the person muted it for. */
  mutedFor: z.array(z.string()),
  /** Its newest raise the person may read. */
  last: z.nullable(alertRaiseSchema),
})
export type AlertRuleRecord = z.infer<typeof alertRuleRecordSchema>

export const alertRulesSchema = z.object({ rules: z.array(alertRuleRecordSchema) })
export type AlertRules = z.infer<typeof alertRulesSchema>

export const alertSetRuleInputSchema = z.strictObject({
  rule: z.enum(alertRuleIds),
  enabled: z.optional(z.boolean()),
  /** One of the thresholds the rule's sentence offers. */
  threshold: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
})

export const alertMuteInputSchema = z.strictObject({
  rule: z.enum(alertRuleIds),
  areaIds: z.array(areaId).check(z.minLength(1), z.maxLength(50)),
  muted: z.boolean(),
})

export const alertRaisedInputSchema = z.strictObject({
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
  /** Only this rule's raises. */
  rule: z.optional(z.enum(alertRuleIds)),
  /** The page after this raise, by its id: the next older ones. */
  after: z.optional(z.string().check(z.uuid())),
  /** Only the raises about this domain, in the counts too. */
  areaId: z.optional(areaId),
})

/**
 * What the rules raised, as the person may read it: how many in all and how many by each rule that
 * raised any, and one page of raises, newest first, of one rule or of all, with whether older ones
 * follow. The counts never depend on the page, so the list can say "20 of 198".
 */
export const alertRaisedSchema = z.object({
  total: z.number(),
  rules: z.array(z.object({ rule: z.enum(alertRuleIds), count: z.number() })),
  raises: z.array(alertRaiseSchema),
  more: z.boolean(),
})
export type AlertRaised = z.infer<typeof alertRaisedSchema>
