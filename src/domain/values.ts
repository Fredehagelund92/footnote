import * as z from 'zod/mini'
import { normalizeName } from './normalize-name.ts'

/*
  The values of a dimension that people write (values without figures, V1). A value is a name: a
  vocabulary term `val:<dimension>/<id>` with other names, published by an owner like any term
  (FR-125). People add one where they write context ("Add Norway to Market") or in Definitions,
  one at a time or as a pasted list. Footnote never reads a value from the data.
*/

/** The limits on what a person writes for one value, and how many one request may add. */
export const valueLimits = {
  name: 200,
  /** Other names people say for it, as for any term. */
  aliases: 20,
  /** How the data writes it (`NO` for Norway): what an agent's filter may pass. */
  writtenAs: 5,
  /** Values added in one request: a pasted list. */
  perRequest: 500,
  /** Values a writer adds in "Applies to" with one item. */
  perItem: 50,
} as const

/** A dimension of one of these types has no values: a date, a number or a yes or no. */
const typesWithoutValues = new Set(['time', 'number', 'boolean'])

/** Whether a dimension whose definitions have these types can have values. */
export const takesValues = (types: readonly (string | null)[]) =>
  !types.some((type) => type !== null && typesWithoutValues.has(type))

/** A name holds a letter or a digit: "***" names no value. */
const hasLetter = (name: string) => /[\p{L}\p{N}]/u.test(name)

/**
 * The part of a value's key its name makes: lower-case letters a to z, digits and `_`, as every
 * key. A name in other letters ("東京") makes a part from its own characters, so it has a key too.
 */
export function valuePart(name: string): string {
  const plain = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (plain || !hasLetter(name)) return plain
  // FNV-1a over the name as it reads: the same name always makes the same part.
  let hash = 0x811c9dc5
  for (const char of normalizeName(name)) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `v_${hash.toString(16).padStart(8, '0')}`
}

/** A value's key in its dimension: `val:market/norway` for Norway in `dim:market`. */
export function valueKeyOf(dimensionKey: string, name: string): string | null {
  const part = valuePart(name.trim())
  return part ? `val:${dimensionKey.slice(dimensionKey.indexOf(':') + 1)}/${part}` : null
}

/** A value as a person writes it: its name, other names, and how the data writes it. */
export type WrittenValue = { name: string; aliases: string[]; writtenAs: string[] }

/**
 * Values from a pasted list, one per line: the name, then any other names after commas ("Norway,
 * Norge"). Blank lines and repeats are left out; a line whose name holds no letter or digit is
 * returned in `unreadable`.
 */
export function pastedValues(
  dimensionKey: string,
  text: string,
): { values: (WrittenValue & { key: string })[]; unreadable: string[] } {
  const values = new Map<string, WrittenValue & { key: string }>()
  const unreadable: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const [name = '', ...aliases] = line.split(',').map((part) => part.trim())
    if (!name) continue
    const key = valueKeyOf(dimensionKey, name)
    if (!key) {
      unreadable.push(line.trim())
      continue
    }
    if (!values.has(key))
      values.set(key, {
        key,
        name,
        aliases: [...new Set(aliases.filter((alias) => alias && alias !== name))],
        writtenAs: [],
      })
  }
  return { values: [...values.values()], unreadable }
}

/** The dimension key of a value key: `dim:market` for `val:market/norway`. */
export const dimensionOfValue = (key: string) => `dim:${key.slice(4, key.indexOf('/'))}`

/** A value a dimension has, live or waiting for an owner, by the words it is written with. */
export type HeldValue = { key: string; name: string; words: string[]; waiting: boolean }

/**
 * Why a value can't be added to a dimension, or null: a dimension of dates, numbers or yes and no
 * has no values, and a word another value has already is that value. `held` are the dimension's
 * values, live and waiting; `types` its definitions' types.
 */
export function valueRefusal(
  dimension: { name: string; types: readonly (string | null)[] },
  value: { key: string; name: string; aliases: readonly string[] },
  held: readonly HeldValue[],
): string | null {
  if (!takesValues(dimension.types))
    return `${dimension.name} holds dates, numbers or yes and no, which have no values to add.`
  const words = [value.name, ...value.aliases].map(normalizeName)
  const other = held.find(
    (h) => h.key === value.key || h.words.some((word) => words.includes(normalizeName(word))),
  )
  if (!other) return null
  return other.waiting
    ? `${other.name} waits for an owner of ${dimension.name} already.`
    : `${dimension.name} has ${other.name} already.`
}

/**
 * The values a draft adds ("Add Norway to Market") that its scope still names and that are not
 * live (`live`, by key), each once.
 */
export function addedValues(
  draft: {
    scope?: { dimensionValues: readonly { value: string }[] }
    newValues?: readonly { key: string; name: string }[]
  },
  live: ReadonlySet<string>,
) {
  const named = new Set(draft.scope?.dimensionValues.map((v) => v.value) ?? [])
  const seen = new Set<string>()
  return (draft.newValues ?? []).filter((value) => {
    if (!named.has(value.key) || live.has(value.key) || seen.has(value.key)) return false
    seen.add(value.key)
    return true
  })
}

/**
 * The values a writer added in "Applies to" that the vocabulary has no term for yet ("Add Norway
 * to Market"), by the key the item's scope names each with: the suggestion's own, as its reason
 * is, never part of the item. They go to the owner with it and are published with it.
 */
export const newValuesSchema = z
  .array(
    z.strictObject({
      key: z.string().check(z.regex(/^val:[a-z0-9_]+\/[a-z0-9_]+$/)),
      name: z.string().check(z.trim(), z.minLength(1), z.maxLength(valueLimits.name)),
    }),
  )
  .check(z.maxLength(valueLimits.perItem))
export type NewValues = z.infer<typeof newValuesSchema>
