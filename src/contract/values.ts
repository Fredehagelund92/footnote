/**
 * The values of a dimension people add in Definitions (values without figures, V1): one at a time
 * or as a pasted list. An owner of the dimension's domain, or an admin, publishes them at once; a
 * value anyone else adds waits for an owner on the Names card (FR-125, FR-141). See
 * `src/domain/values.ts`.
 */
import * as z from 'zod/mini'
import { valueLimits } from '../domain/values.ts'

const text = z.string().check(z.trim(), z.minLength(1), z.maxLength(valueLimits.name))

export const writtenValueSchema = z.strictObject({
  name: text,
  /** Other names people say for it ("Norge"). */
  aliases: z._default(z.array(text).check(z.maxLength(valueLimits.aliases)), []),
  /** How the data writes it ("NO"), as an agent's filter passes it. */
  writtenAs: z._default(z.array(text).check(z.maxLength(valueLimits.writtenAs)), []),
})

export const addValuesSchema = z.strictObject({
  /** The dimension, by key: `dim:market`. */
  dimension: z.string().check(z.regex(/^dim:[a-z0-9_]+$/)),
  values: z.array(writtenValueSchema).check(z.minLength(1), z.maxLength(valueLimits.perRequest)),
})

export const addValuesResultSchema = z.object({
  /** Published now, by an owner or an admin, or waiting for an owner on the Names card. */
  outcome: z.enum(['published', 'waiting']),
  /** The values added, by key, in the order given. */
  values: z.array(z.object({ key: z.string(), name: z.string() })),
  /** The edition that made them live; null while they wait. */
  edition: z.nullable(z.string()),
})

export type AddValues = z.infer<typeof addValuesSchema>
export type AddValuesResult = z.infer<typeof addValuesResultSchema>
export type WrittenValueInput = z.input<typeof writtenValueSchema>
