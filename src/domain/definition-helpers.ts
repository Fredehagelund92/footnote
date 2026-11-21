import { contentDigest } from './canonical.ts'

/*
  What every definitions connector does the same way, as pure functions it imports: the other
  names a tool lists, a description cut to its copy, a domain read through the source's domain
  names, and the change mark of a meaning (docs/connectors/authoring.md, "Mapping rules"). Cube,
  the static list and the template use them, so a new connector gets these rules by calling them,
  not by writing them again.
*/

/** The most other names Footnote keeps for one definition: as many as a term may have (FR-107). */
export const SYNONYMS_MAX = 20
/** The longest other name Footnote keeps, in characters. */
export const SYNONYM_LENGTH_MAX = 200
/** The longest description copy, in characters (CON-207). */
export const DESCRIPTION_COPY_MAX = 500

/** A Footnote domain id: what a domain hint must be. */
export const domainIdPattern = /^[a-z][a-z0-9_]{1,39}$/

/**
 * The other names a tool lists for a definition (Cube's `meta.synonyms`), trimmed, with inner
 * spaces made one, each once whatever its case, at most as many as a term may have. Anything
 * else there (a number, an empty or overlong name) is left out.
 */
export function synonymsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim().replace(/\s+/g, ' ')
    if (!name || Array.from(name).length > SYNONYM_LENGTH_MAX || seen.has(name.toLowerCase()))
      continue
    seen.add(name.toLowerCase())
    names.push(name)
  }
  return names.slice(0, SYNONYMS_MAX)
}

/**
 * A description as Footnote keeps it: its first 500 characters, as a copy, and whether it was cut,
 * so the connector warns that it was (its own `description_cut`). Null for none or an empty one.
 */
export function descriptionCopy(text: string | null | undefined): {
  copy: string | null
  cut: boolean
} {
  if (!text) return { copy: null, cut: false }
  const characters = Array.from(text)
  return {
    copy: characters.slice(0, DESCRIPTION_COPY_MAX).join(''),
    cut: characters.length > DESCRIPTION_COPY_MAX,
  }
}

/**
 * The domain a definition's own value names, read through the source's domain names (CON-206):
 * a hint when it is a domain id, nothing when the tool names none, and nothing, said as
 * `invalid`, when it names something that is not a domain id. The connector warns
 * `invalid_domain` on an invalid one; it never guesses a domain.
 */
export function domainHint(
  value: unknown,
  domainNames: Readonly<Record<string, string>> = {},
): { areaHint: string | null; domainSource: 'source' | 'none'; invalid: boolean } {
  if (value === undefined || value === null)
    return { areaHint: null, domainSource: 'none', invalid: false }
  const domain =
    typeof value === 'string' && Object.hasOwn(domainNames, value) ? domainNames[value] : value
  return typeof domain === 'string' && domainIdPattern.test(domain)
    ? { areaHint: domain, domainSource: 'source', invalid: false }
    : { areaHint: null, domainSource: 'none', invalid: true }
}

/** True for a value that says nothing: null, false, an empty text, list or object. */
const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === false ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && Object.keys(value).length === 0)

/**
 * A meaning without the parts that say nothing: every key whose value is null, false, an empty
 * text, list or object, at every depth, so two shapes of the same meaning (a key absent in one,
 * null or empty in the other) are the same. A list keeps its order and its entries.
 */
export function withoutEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEmpty)
  if (typeof value !== 'object' || value === null) return value
  const kept: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const normal = withoutEmpty(entry)
    if (!isEmpty(normal)) kept[key] = normal
  }
  return kept
}

/**
 * The change mark of a definition: the SHA-256 of its meaning as canonical JSON, keys in order,
 * with the parts that say nothing left out (`withoutEmpty`). Put in what it means (its
 * calculation, with the meanings of the records it is built from, its type, title and
 * description); leave out its domain, its other names, its file and anything that names where
 * the tool was built. `keepEmpty` hashes the meaning as it is: for a connector whose marks were
 * first computed that way, so they stay as they were without a `markVersion` bump.
 */
export function meaningMark(
  meaning: unknown,
  options: { keepEmpty?: boolean } = {},
): Promise<string> {
  return contentDigest(options.keepEmpty ? meaning : withoutEmpty(meaning))
}

/** The most definitions, and the most columns, Footnote keeps of what one metric is built from. */
export const BUILT_FROM_MAX = 50
/** A column as Footnote keeps it: one identifier, so no part of a calculation can ride in one. */
export const columnNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

// The words of a SQL calculation that never name a column. Types and date parts are not here:
// where they sit says what they are (after `::` or `AS`, before a quoted literal, in EXTRACT).
const sqlKeywords = new Set(
  'all and any as asc at between by case cast current desc distinct else end escape exists false filter first following from group ignore in interval is last like ilike not null nulls or order over partition precision preceding range respect row rows similar some then time to true unbounded when where within zone'.split(
    ' ',
  ),
)
const niladicFunctions = new Set([
  'current_date',
  'current_time',
  'current_timestamp',
  'localtime',
  'localtimestamp',
  'current_user',
  'session_user',
  'user',
])
const dateParts = new Set(
  'year years month months week weeks day days hour hours minute minutes second seconds quarter quarters'.split(
    ' ',
  ),
)
const sqlToken =
  /'(?:[^']|'')*'|"((?:[^"]|"")*)"|`([^`]*)`|\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+|([A-Za-z_][A-Za-z0-9_$]*)|::|\S/gi

/**
 * The columns a SQL calculation reads, by name, in the order it first names each: `amount_eur`
 * and `exchange_rate_usd` of `SUM(amount_eur * exchange_rate_usd)`. Functions (a bare `current_date` too), keywords, types,
 * literals, the date part after `interval` or a number, and a qualifier before a dot are none, and a template's `{{ }}` is left out. Only the
 * names cross, never the calculation (CON-207); a name Footnote cannot keep as one identifier is
 * left out rather than guessed.
 */
export function columnsOf(expression: string): string[] {
  const text = expression
    .replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g, ' ')
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
  const tokens = [...text.matchAll(sqlToken)].map((match) => ({
    text: match[0],
    name: match[3] ?? match[1]?.replace(/""/g, '"') ?? match[2] ?? null,
    bare: match[3] !== undefined,
  }))
  const columns: string[] = []
  tokens.forEach((token, i) => {
    const before = tokens[i - 1]?.text.toLowerCase()
    const after = tokens[i + 1]?.text
    if (token.name === null || !columnNamePattern.test(token.name)) return
    if (after === '.' || before === '::' || before === 'as') return
    if (token.bare) {
      const word = token.name.toLowerCase()
      if (after === '(' || after?.startsWith("'") || sqlKeywords.has(word)) return
      if (niladicFunctions.has(word)) return
      if (dateParts.has(word) && before && (before === 'interval' || /^[\d.]/.test(before))) return
      if (before === '(' && tokens[i - 2]?.text.toLowerCase() === 'extract') return
    }
    if (!columns.includes(token.name)) columns.push(token.name)
  })
  return columns.slice(0, BUILT_FROM_MAX)
}

/** The most values one variant is told apart by: currency and channel are two. */
export const VARIANT_BY_MAX = 5
/** The longest value a variant is told apart by, in characters. */
export const VARIANT_VALUE_MAX = 200

/** One value a variant of a family is told apart by: what its filter compares, and with what. */
export type VariantValue = {
  /** The column or dimension the filter compares, by its name in the tool: `currency_code`. */
  name: string
  /** The dimension of that name the connector reads, by ref; null when it reads none. */
  ref: string | null
  /** The literal the model compares it with: `EUR`. A value written in the model, never data. */
  value: string
}

// A filter that compares one column or dimension with one quoted literal: `{CUBE}.currency_code =
// 'EUR'`, `{CUBE.channel} IN ('web')`, `'EUR' = currency_code`, or dbt's
// `{{ Dimension('order__currency_code') }} = 'EUR'`. The column is the last name in the reference.
const reference = String.raw`\{\{\s*Dimension\(\s*'[^']+'\s*\)(?:\.\w+\([^)]*\))*\s*\}\}|\$?\{[\w.]+\}(?:\.\w+)?|\w+(?:\.\w+)*`
const literal = String.raw`'((?:[^'\\]|'')*)'`
const comparisons = new RegExp(
  String.raw`(${reference})\s*(?:==?|\s+in\s*\(\s*${literal}\s*\))\s*(?:${literal})?|${literal}\s*==?\s*(${reference})`,
  'gi',
)

/** The column a reference names: `currency_code` of `{CUBE}.currency_code` or `order__currency_code`. */
function columnOf(text: string): string | null {
  const dimension = /Dimension\(\s*'([^']+)'/.exec(text)
  const name = dimension ? dimension[1]!.split('__').at(-1)! : /(\w+)\}?$/.exec(text)?.[1]
  return name && /^[A-Za-z_]\w*$/.test(name) ? name : null
}

/**
 * What a metric's filters say about it as a variant of a family (FR-142): the filters with the
 * literal each compares a column with left out (`{CUBE}.currency_code = ?`), and those literals in
 * the order the filters have them. A metric per currency and channel is the same filters with other
 * literals. Null when the filters compare nothing with a literal, or hold a literal Footnote
 * cannot tell the column of: then it is no variant, only a metric. Only names and literals cross,
 * never the calculation (CON-207).
 */
export function filterVariant(
  filters: readonly string[],
): { shape: string[]; by: Omit<VariantValue, 'ref'>[] } | null {
  const by: Omit<VariantValue, 'ref'>[] = []
  const shape: string[] = []
  for (const filter of filters) {
    type Part = string | undefined
    const left = filter.replace(
      comparisons,
      (match: string, ref: Part, inList: Part, value: Part, before: Part, after: Part) => {
        const column = columnOf(ref ?? after ?? '')
        const said = inList ?? value ?? before
        if (column === null || said === undefined) return match
        by.push({ name: column, value: said.replace(/''/g, "'") })
        return match.replace(`'${said}'`, '?')
      },
    )
    shape.push(left)
  }
  // A literal the comparisons did not take: something else is compared, so it is no variant.
  if (!by.length || shape.some((filter) => /'/.test(filter.replace(/\{\{[^}]*\}\}/g, ''))))
    return null
  if (
    by.length > VARIANT_BY_MAX ||
    by.some(({ value }) => !value.trim() || [...value].length > VARIANT_VALUE_MAX)
  )
    return null
  return { shape, by }
}

/** The longest name of a family a source declares, in characters. */
export const FAMILY_NAME_MAX = 200

/** A family a source declares a metric is a variant of (FR-142, D9), as it writes it. */
export type DeclaredFamily = {
  /** The family's name as the source writes it: `accrued_share` or "Accrued share". */
  name: string
  /** What tells this variant apart: each name and value of `by`, in the order written. */
  by: VariantValue[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The family a member's `meta` declares (Footnote's one optional convention, D9):
 * `meta.footnote.family`, the family's name, and `meta.footnote.by`, what tells this variant apart
 * (`{currency: EUR}`), each name with the dimension of that name the connector reads, by ref
 * (`dimensionRef`). Null when it declares none; `invalid` when it declares one Footnote cannot
 * keep (no name, no `by`, more than five values, a value that is not a short text, number or
 * true/false), which the connector warns as `invalid_family` and reads as none. Read as written,
 * never guessed.
 */
export function declaredFamily(
  meta: unknown,
  dimensionRef: (name: string) => string | null = () => null,
): DeclaredFamily | 'invalid' | null {
  const footnote = isObject(meta) ? meta.footnote : undefined
  if (!isObject(footnote) || footnote.family === undefined || footnote.family === null) return null
  const name = typeof footnote.family === 'string' ? footnote.family.trim() : ''
  if (!name || [...name].length > FAMILY_NAME_MAX || /[\n\r]/.test(name)) return 'invalid'
  if (!isObject(footnote.by)) return 'invalid'
  const by: VariantValue[] = []
  for (const [axis, raw] of Object.entries(footnote.by)) {
    const value =
      typeof raw === 'string'
        ? raw.trim()
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : ''
    const column = axis.trim()
    if (!column || [...column].length > 500 || !value || [...value].length > VARIANT_VALUE_MAX)
      return 'invalid'
    by.push({ name: column, ref: dimensionRef(column), value })
  }
  if (!by.length || by.length > VARIANT_BY_MAX) return 'invalid'
  return { name, by }
}
