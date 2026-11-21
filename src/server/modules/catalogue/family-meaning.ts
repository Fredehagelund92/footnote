import { ORPCError } from '@orpc/client'
import type { FamilyMeaningInput, FamilyMeaningVersion } from '../../../contract/index.ts'
import { declaredWords } from '../../../domain/metric-families.ts'
import type { Queryable } from '../../db/database.ts'

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

const versions = `select v.revision, v.choice, v.member_key as member,
         (select x.name from vocab_term_versions x where x.term_key = v.member_key
           order by x.version_no desc limit 1) as "memberName",
         v.words, v.made_by::text as "personId", ${iso('v.made_at')} as at
    from family_meaning_versions v`

/**
 * What a family of metrics means, as an owner chose it (FR-142, M1): one variant's own words,
 * words written here for the family, or the rule again. An owner of the family's domain or an
 * admin chooses; words its source writes for the family can't be replaced. Every choice is kept,
 * like a term's versions. The catalogue works the meaning out from the choice at each read.
 */
export function createFamilyMeaningService(tx: Queryable) {
  /** The live family, who may change its meaning, and what its source and owners said so far. */
  async function stateOf(key: string, member: string | null) {
    const [row] = await tx.query<{
      found: boolean
      mayChange: boolean
      areaName: string | null
      declared: (string | null)[]
      revision: number | null
      memberWords: string | null
      memberFound: boolean
    }>(
      `with family as (
         select t.definition_refs as refs from serving_vocabulary((select seq from live_edition)) t
          where t.key = $1 and t.kind = 'metric_group' and cardinality(t.definition_refs) > 0),
       variant as (
         select d.description_copy as words from serving_vocabulary((select seq from live_edition)) t
           left join definitions d on d.ref = t.definition_refs[1]
          where t.key = $2 and t.kind = 'metric' and t.parent_key = $1)
       select exists (select 1 from family) as found,
              cl_is_admin_now() or coalesce(cl_is_owner_now(cl_family_area($1)), false) as "mayChange",
              (select a.name from areas a where a.id = cl_family_area($1)) as "areaName",
              coalesce((select json_agg(d.family_description)
                          from definitions d, family f
                         where d.ref = any(f.refs) and d.missing_since_snapshot is null), '[]') as declared,
              (select m.revision from family_meanings m where m.family_key = $1) as revision,
              (select words from variant) as "memberWords",
              exists (select 1 from variant) as "memberFound"`,
      [key, member],
    )
    return row!
  }

  async function set(input: FamilyMeaningInput): Promise<FamilyMeaningVersion> {
    const member = input.choice === 'member' ? (input.member ?? null) : null
    const words = input.choice === 'written' ? (input.words?.trim() ?? null) : null
    if ((input.choice === 'member') !== !!input.member || (input.choice === 'written') !== !!words)
      throw new ORPCError('BAD_REQUEST', {
        message: 'Choose one variant for its words, or write words for the family, not both.',
      })
    const state = await stateOf(input.key, member)
    if (!state.found)
      throw new ORPCError('NOT_FOUND', {
        message: "We couldn't find this family of metrics. Its tool may no longer read it.",
      })
    if (!state.mayChange)
      throw new ORPCError('FORBIDDEN', {
        message: state.areaName
          ? `Only an owner of ${state.areaName} or an admin can change what it means.`
          : 'Only an admin can change what a family in no domain means.',
      })
    if (declaredWords(state.declared))
      throw new ORPCError('CONFLICT', {
        message: 'Its tool writes what this family means, so the words are changed there.',
      })
    if (member && !state.memberFound)
      throw new ORPCError('NOT_FOUND', { message: 'That variant is no longer in this family.' })
    if (member && !state.memberWords)
      throw new ORPCError('BAD_REQUEST', {
        message: 'That variant has no words of its own in its tool. Choose another.',
      })
    if ((state.revision ?? 0) !== input.revision)
      throw new ORPCError('CONFLICT', {
        message:
          'Someone changed what this family means after you opened it. Look at it again, then try again.',
      })
    const [made] = await tx.query<{ revision: number }>(
      `insert into family_meanings (family_key, choice, member_key, words, updated_by)
       values ($1, $2, $3, $4, cl_person())
       on conflict (family_key) do update
         set choice = excluded.choice, member_key = excluded.member_key, words = excluded.words,
             revision = family_meanings.revision + 1, updated_by = cl_person(), updated_at = now()
         where family_meanings.revision = $5
       returning revision`,
      [input.key, input.choice, member, words, input.revision],
    )
    if (!made)
      throw new ORPCError('CONFLICT', {
        message:
          'Someone changed what this family means after you opened it. Look at it again, then try again.',
      })
    const [version] = await tx.query<FamilyMeaningVersion>(
      `${versions} where v.family_key = $1 and v.revision = $2`,
      [input.key, made.revision],
    )
    return version!
  }

  /** Every choice of what the family means, newest first. */
  async function history(key: string): Promise<FamilyMeaningVersion[]> {
    const found = await tx.query<FamilyMeaningVersion>(
      `${versions} where v.family_key = $1 order by v.revision desc`,
      [key],
    )
    if (!found.length && !(await stateOf(key, null)).found)
      throw new ORPCError('NOT_FOUND', {
        message: "We couldn't find this family of metrics. Its tool may no longer read it.",
      })
    return found
  }

  return { set, history }
}
