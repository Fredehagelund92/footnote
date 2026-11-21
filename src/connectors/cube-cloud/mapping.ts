import * as z from 'zod/mini'
import type { RuntimeDefinition, RuntimeMessage } from '../../domain/connector-runtime.ts'
import {
  declaredFamily,
  descriptionCopy,
  domainHint,
  meaningMark,
  synonymsOf,
} from '../../domain/definition-helpers.ts'
import { manifest } from './manifest.ts'

/*
  What Cube Cloud's `/v1/meta` says, made into definitions: pure, with no request and no clock,
  so a test compares it with the fixture's expected definitions. Each public cube and view is a
  group and each of its public members a definition, under the same `cube:` refs as Cube model
  files give, so a model moved to Cube Cloud keeps its refs (CON-117).

  `/v1/meta` holds no calculation, so the mark is what it says of a member (marks: metadata,
  CON-505): its type, how it adds up, its title, description, format and metadata, and the member
  it takes them from. Only those keys are read: anything else in an answer, such as SQL in an
  extended one, is never kept, hashed or passed on.
*/

const memberName = /^[A-Za-z_][A-Za-z0-9_]{0,199}\.[A-Za-z_][A-Za-z0-9_]{0,199}$/
const groupName = /^[A-Za-z_][A-Za-z0-9_]{0,199}$/
const words = z.optional(z.nullable(z.string()))
const record = z.optional(z.nullable(z.record(z.string(), z.unknown())))

/** A measure or dimension as `/v1/meta` gives it, as far as a definition and its mark read it. */
const memberSchema = z.object({
  name: z.string().check(z.regex(memberName)),
  title: words,
  description: words,
  type: words,
  aggType: words,
  meta: record,
  format: z.optional(z.unknown()),
  currency: words,
  cumulative: z.optional(z.nullable(z.boolean())),
  granularities: z.optional(z.nullable(z.array(z.unknown()))),
  values: z.optional(z.nullable(z.array(z.unknown()))),
  key: words,
  drillMembers: z.optional(z.nullable(z.array(z.unknown()))),
  /** The cube member a view member stands for: `orders.revenue`. */
  aliasMember: words,
  isVisible: z.optional(z.boolean()),
  public: z.optional(z.boolean()),
})
type Member = z.infer<typeof memberSchema>

const cubeSchema = z.object({
  name: z.string().check(z.regex(groupName)),
  type: words,
  meta: record,
  isVisible: z.optional(z.boolean()),
  public: z.optional(z.boolean()),
  measures: z.optional(z.array(z.unknown())),
  dimensions: z.optional(z.array(z.unknown())),
})

/** `/v1/meta`'s answer: its cubes and views. Each is checked on its own, so one odd view is one. */
export const metaSchema = z.object({ cubes: z.array(z.unknown()) })
export type Meta = z.infer<typeof metaSchema>

/** The value types Cube gives a member; any other is said as unknown (null). */
const valueTypes = new Set(['number', 'string', 'time', 'boolean', 'geo'])

type Warning = Extract<RuntimeMessage, { type: 'warning' }>

/** The answer's text as `/v1/meta`'s, or null when it is not one. */
export function parseMeta(text: string): Meta | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = metaSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/** Shown to whoever may query the deployment: Cube says hidden in either word. */
const shown = (entry: { isVisible?: boolean | undefined; public?: boolean | undefined }) =>
  entry.isVisible !== false && entry.public !== false

/**
 * The member's metadata without what a mark leaves out: its domain, its other names and the family
 * Footnote's convention declares (`footnote`).
 */
function metaMeaning(meta: Member['meta']): Record<string, unknown> | null {
  if (!meta) return null
  const { domain: _domain, synonyms: _synonyms, footnote: _footnote, ...rest } = meta
  return rest
}

/**
 * A view member's own name when the view joins it with a prefix, as Cube model files give it:
 * `marketing.orders_country` stands for `orders.country`, and its own name is `country`. Null
 * when the name after the view is already its own, or the view renamed it otherwise.
 */
export function baseNameOf(name: string, aliasMember: string | null | undefined): string | null {
  if (!aliasMember) return null
  const own = name.slice(name.indexOf('.') + 1)
  const [from, base] = aliasMember.split('.')
  if (!from || !base || own === base) return null
  const prefix = `${from}_`
  return own.startsWith(prefix) && own.length > prefix.length ? own.slice(prefix.length) : null
}

/**
 * Every definition `/v1/meta` gives, with the warnings to send before them and whether the read
 * is whole. A cube or view Cube hides, or one it describes in a way this does not read, is left
 * out; a member it hides is too. The refs are sorted, so the order of the answer never matters.
 */
export async function mapDefinitions(
  meta: Meta,
  domainNames: Readonly<Record<string, string>> = {},
): Promise<{ definitions: RuntimeDefinition[]; warnings: Warning[]; complete: boolean }> {
  const definitions: RuntimeDefinition[] = []
  const warnings: Warning[] = []
  let complete = true
  const warn = (code: string, target: string) => warnings.push({ type: 'warning', code, target })
  const named = new Set<string>()

  for (const raw of meta.cubes) {
    const cube = cubeSchema.safeParse(raw)
    if (!cube.success) {
      const name = (raw as { name?: unknown } | null)?.name
      warn(
        `${manifest.id}.unreadable_view`,
        typeof name === 'string' ? [...name].slice(0, 200).join('') : 'view',
      )
      complete = false
      continue
    }
    const group = cube.data
    if (!shown(group)) continue
    const members: { kind: 'metric' | 'dimension'; member: Member }[] = []
    let readable = true
    for (const [kind, list] of [
      ['metric', group.measures ?? []],
      ['dimension', group.dimensions ?? []],
    ] as const)
      for (const value of list) {
        const member = memberSchema.safeParse(value)
        if (member.success && member.data.name.startsWith(`${group.name}.`))
          members.push({ kind, member: member.data })
        else readable = false
      }
    if (!readable) {
      // A view read in part would mark the members left out as gone: it is left out whole.
      warn(`${manifest.id}.unreadable_view`, group.name)
      complete = false
      continue
    }

    const groupDomain = domainHint(group.meta?.domain, domainNames)
    if (groupDomain.invalid) warn('invalid_domain', group.name)
    else if (groupDomain.areaHint === null) warn('missing_domain', group.name)

    // A view's dimensions by their own names: what a declared family's `by` names.
    const dimensionRefs = new Map(
      members.flatMap(({ kind, member }) =>
        kind === 'dimension' && shown(member)
          ? [[member.name.slice(group.name.length + 1), `${manifest.refPrefix}:${member.name}`]]
          : [],
      ),
    )
    for (const { kind, member } of members) {
      if (!shown(member) || named.has(member.name)) continue
      named.add(member.name)
      const own = domainHint(member.meta?.domain, domainNames)
      if (own.invalid) warn('invalid_domain', member.name)
      // A member's own valid domain wins over its view's.
      const domain = own.areaHint === null ? groupDomain : own
      // The family its `meta.footnote` declares, read as written (D9); one that cannot be kept
      // is none.
      const family = declaredFamily(member.meta, (name) => dimensionRefs.get(name) ?? null)
      if (family === 'invalid') warn('invalid_family', member.name)
      definitions.push({
        ref: `${manifest.refPrefix}:${member.name}`,
        kind,
        name: member.name,
        title: member.title?.trim() || null,
        descriptionCopy: descriptionCopy(member.description).copy,
        valueType: member.type && valueTypes.has(member.type) ? member.type : null,
        visibleGroups: null,
        areaHint: domain.areaHint,
        domainSource: domain.domainSource,
        modelFile: null,
        synonyms: synonymsOf(member.meta?.synonyms),
        baseName: baseNameOf(member.name, member.aliasMember),
        ...(family && family !== 'invalid' ? { family } : {}),
        // What `/v1/meta` says of it, and the member it stands for: never its domain or its
        // other names, which change no meaning (CON-505).
        changeMark: await meaningMark({
          kind,
          type: member.type,
          aggType: member.aggType,
          title: member.title,
          description: member.description,
          format: member.format,
          currency: member.currency,
          cumulative: member.cumulative,
          granularities: member.granularities,
          values: member.values,
          key: member.key,
          drillMembers: member.drillMembers,
          aliasMember: member.aliasMember,
          meta: metaMeaning(member.meta),
        }),
      })
    }
  }
  definitions.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return { definitions, warnings, complete }
}
