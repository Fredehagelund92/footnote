import { ORPCError } from '@orpc/client'
import type {
  FamilyMeaningInput,
  FamilyMeaningVersion,
  FamilyUsualData,
  FamilyUsualInput,
} from '../../../contract/index.ts'
import { declaredWords } from '../../../domain/metric-families.ts'
import type { Queryable } from '../../db/database.ts'

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

const versions = `select v.revision, v.choice, v.words, v.made_by::text as "personId",
         ${iso('v.made_at')} as at
    from family_meaning_versions v`

/**
 * What a family of metrics means, as an owner chose it (FR-142, M1): words written here for the
 * family, or worked out from its variants again. An owner of the family's domain or an admin
 * chooses; words its source writes for the family can't be replaced. Every choice is kept, like a
 * term's versions. The catalogue works the meaning out from the choice at each read.
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
      memberFound: boolean
    }>(
      `with family as (
         select t.definition_refs as refs from serving_vocabulary((select seq from live_edition)) t
          where t.key = $1 and t.kind = 'metric_group' and cardinality(t.definition_refs) > 0),
       variant as (
         select 1 from serving_vocabulary((select seq from live_edition)) t
          where t.key = $2 and t.kind = 'metric' and t.parent_key = $1)
       select exists (select 1 from family) as found,
              cl_is_admin_now() or coalesce(cl_is_owner_now(cl_family_area($1)), false) as "mayChange",
              (select a.name from areas a where a.id = cl_family_area($1)) as "areaName",
              coalesce((select json_agg(d.family_description)
                          from definitions d, family f
                         where d.ref = any(f.refs) and d.missing_since_snapshot is null), '[]') as declared,
              (select m.revision from family_meanings m where m.family_key = $1) as revision,
              exists (select 1 from variant) as "memberFound"`,
      [key, member],
    )
    return row!
  }

  async function set(input: FamilyMeaningInput): Promise<FamilyMeaningVersion> {
    const words = input.choice === 'written' ? (input.words?.trim() ?? null) : null
    if ((input.choice === 'written') !== !!words)
      throw new ORPCError('BAD_REQUEST', {
        message: 'Write words for the family, or have them worked out from its variants.',
      })
    const state = await stateOf(input.key, null)
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
    if ((state.revision ?? 0) !== input.revision)
      throw new ORPCError('CONFLICT', {
        message:
          'Someone changed what this family means after you opened it. Look at it again, then try again.',
      })
    const [made] = await tx.query<{ revision: number }>(
      `insert into family_meanings (family_key, choice, words, updated_by)
       values ($1, $2, $3, cl_person())
       on conflict (family_key) do update
         set choice = excluded.choice, words = excluded.words,
             revision = family_meanings.revision + 1, updated_by = cl_person(), updated_at = now()
         where family_meanings.revision = $4
       returning revision`,
      [input.key, input.choice, words, input.revision],
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

  /**
   * Picks the variant agents read when a question names none of the family's values, or none, so
   * they ask. Who may pick is who may change what the family means; the source never picks.
   */
  async function setUsual(input: FamilyUsualInput): Promise<FamilyUsualData> {
    const state = await stateOf(input.key, input.member)
    if (!state.found)
      throw new ORPCError('NOT_FOUND', {
        message: "We couldn't find this family of metrics. Its tool may no longer read it.",
      })
    if (!state.mayChange)
      throw new ORPCError('FORBIDDEN', {
        message: state.areaName
          ? `Only an owner of ${state.areaName} or an admin can pick its usual variant.`
          : 'Only an admin can pick the usual variant of a family in no domain.',
      })
    if (input.member && !state.memberFound)
      throw new ORPCError('NOT_FOUND', { message: 'That variant is no longer in this family.' })
    const [current] = await tx.query<{ revision: number }>(
      'select revision from family_usual where family_key = $1',
      [input.key],
    )
    const stale = () =>
      new ORPCError('CONFLICT', {
        message:
          "Someone changed this family's usual variant after you opened it. Look at it again, then try again.",
      })
    if ((current?.revision ?? 0) !== input.revision) throw stale()
    const [made] = await tx.query<{ revision: number; personId: string; at: string }>(
      `insert into family_usual (family_key, member_key, updated_by)
       values ($1, $2, cl_person())
       on conflict (family_key) do update
         set member_key = excluded.member_key, revision = family_usual.revision + 1,
             updated_by = cl_person(), updated_at = now()
         where family_usual.revision = $3
       returning revision, updated_by::text as "personId", ${iso('updated_at')} as at`,
      [input.key, input.member, input.revision],
    )
    if (!made) throw stale()
    return {
      member: input.member,
      chosen: { personId: made.personId, at: made.at },
      revision: made.revision,
    }
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

  return { set, setUsual, history }
}
