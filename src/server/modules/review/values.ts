import { ORPCError } from '@orpc/client'
import type { WaitingValue } from '../../../contract/inbox.ts'
import type { AddValues, AddValuesResult } from '../../../contract/values.ts'
import { contentDigest } from '../../../domain/canonical.ts'
import { textFindings, type Draft, type FormatFinding } from '../../../domain/draft.ts'
import {
  addedValues,
  dimensionOfValue,
  valueKeyOf,
  valueRefusal,
  type HeldValue,
  type NewValues,
} from '../../../domain/values.ts'
import { termDigestContent } from '../../../domain/vocabulary.ts'
import type { Queryable } from '../../db/database.ts'
import { missing } from '../../../contract/refusals.ts'
import { lockReleases, publishEdition } from '../editions/index.ts'
import { proposalEvents } from './records.ts'
import { recordTermVersions, type TermVersion } from './term-versions.ts'

/*
  The values of a dimension people write (values without figures, V1). A value is a vocabulary term
  `val:<dimension>/<id>` and goes live the way every term does (FR-125): a version, an accepted
  proposal, a decision by an owner of its domain or an admin, which the database checks, and an
  edition. Footnote reads no value from the data.

  Two ways in. A writer adds one in "Applies to": it rides with the suggestion (`newValues`), the
  owner sees it with the item, and publishing the item publishes it in the same edition, in the
  item's domain. Or anyone adds some in Definitions: an owner of the dimension's domain or an admin
  publishes them at once; anyone else's wait for one on the Names card, as suggestions.
*/

/** A live dimension, the domain its values take, and its definitions' types. */
type Dimension = { key: string; name: string; areaId: string | null; types: (string | null)[] }

/** The proposal a waiting value is, as the Names card decides it. */
type WaitingRow = WaitingValue & { versionId: string; revision: number }

const REASON = 'Added values people wrote.'

async function liveDimension(tx: Queryable, key: string): Promise<Dimension> {
  // Its domain as the catalogue shows it: the vocabulary's, else the one its source gives.
  const [row] = await tx.query<Dimension>(
    `select t.key,v.name,
            coalesce(v.area_id,(select d.area_id from serving_source_domains((select seq from live_edition)) d
                                 where d.key=t.key)) as "areaId",
            coalesce((select array_agg(d.value_type) from vocab_term_refs r
                        join definitions d on d.ref=r.definition_ref where r.version_id=v.id),'{}') as types
       from vocab_term_service s join vocab_term_versions v on v.id=s.version_id
       join vocab_terms t on t.key=s.term_key
      where s.editions @> (select seq from live_edition) and t.key=$1 and t.kind='dimension'`,
    [key],
  )
  if (!row) throw new ORPCError('NOT_FOUND', { message: missing('this dimension') })
  return row
}

/** The values a dimension has live, and the ones that wait for an owner, with their words. */
async function heldValues(tx: Queryable, dimensionKey: string): Promise<HeldValue[]> {
  return tx.query<HeldValue>(
    `select s.term_key as key,v.name,array[v.name]||v.aliases as words,false as waiting
       from vocab_term_service s join vocab_term_versions v on v.id=s.version_id
       join vocab_terms t on t.key=s.term_key
      where s.editions @> (select seq from live_edition) and v.parent_key=$1
     union all
     select v.term_key,v.name,array[v.name]||v.aliases,true
       from proposals p join vocab_term_versions v on v.id=p.vocab_version_id
       join vocab_terms t on t.key=v.term_key
      where p.subject='vocabulary' and p.state='submitted' and v.parent_key=$1`,
    [dimensionKey],
  )
}

/** Whether the person publishes values in a domain at once, and in what capacity. */
async function capacityIn(
  tx: Queryable,
  areaId: string | null,
): Promise<TermVersion['capacity'] | null> {
  const [me] = await tx.query<{ owner: boolean; admin: boolean }>(
    'select $1::text is not null and cl_is_owner_now($1) as owner,cl_is_admin_now() as admin',
    [areaId],
  )
  return me?.owner ? 'owner' : me?.admin ? 'administrator' : null
}

/** Nothing to record: no value was decided. */
const noEvents = async (_edition: string | null) => {}

export function createValuesService(tx: Queryable) {
  /** Waiting values whose key is taken by a published one now: they wait for nothing. */
  async function closeSettled(keys: readonly string[]) {
    if (!keys.length) return
    const closed = await tx.query<{ id: string; revision: number; areaId: string | null }>(
      `update proposals p set state='withdrawn',closed_at=now(),reason='Published already.'
        from vocab_term_versions v
       where v.id=p.vocab_version_id and p.subject='vocabulary' and p.state='submitted'
         and v.term_key=any($1::text[])
       returning p.id::text,p.revision,p.area_id as "areaId"`,
      [keys],
    )
    await proposalEvents(
      tx,
      closed.map((p) => ({
        p: { id: p.id, areaId: p.areaId, state: 'withdrawn', revision: p.revision },
        kind: 'withdrawn',
        data: { reason: 'Published already.' },
      })),
    )
  }

  /** Makes the keys of new values, so a version and an item's scope can name them. */
  async function keys(values: readonly { key: string }[]) {
    await tx.query(
      `insert into vocab_terms(key,kind) select k,'dimension_value' from unnest($1::text[]) k
       on conflict (key) do nothing`,
      [values.map((value) => value.key)],
    )
  }

  /**
   * Adds values to a dimension, as a person writes them in Definitions: one, or a pasted list.
   * Every value is checked first, and nothing is added when one is refused.
   */
  async function add(input: AddValues): Promise<AddValuesResult> {
    await lockReleases(tx)
    const dimension = await liveDimension(tx, input.dimension)
    const held = await heldValues(tx, dimension.key)
    const findings: FormatFinding[] = []
    const values: (TermVersion & { key: string })[] = []
    input.values.forEach((written, index) => {
      const field = `values.${index}`
      const name = written.name.trim()
      const key = valueKeyOf(dimension.key, name)
      const aliases = [
        ...new Set(written.aliases.map((a) => a.trim()).filter((a) => a && a !== name)),
      ]
      const writtenAs = [...new Set(written.writtenAs.map((w) => w.trim()).filter(Boolean))]
      const sensitive = textFindings({ name, aliases, writtenAs }, field)
      if (sensitive.length) {
        findings.push(
          ...sensitive.map((f) => ({
            ...f,
            message:
              'A value is a name: it may not hold an email address, a phone number or a key.',
          })),
        )
        return
      }
      if (!key) {
        findings.push({
          code: 'value_name',
          field,
          message: `“${name}” has no letter or digit to name a value with.`,
          severity: 'error',
        })
        return
      }
      const refusal =
        valueRefusal(dimension, { key, name, aliases }, held) ??
        (values.some((v) => v.key === key) ? `${name} is in the list twice.` : null)
      if (refusal) {
        findings.push({ code: 'value_taken', field, message: refusal, severity: 'error' })
        return
      }
      values.push({
        key,
        kind: 'dimension_value',
        parentKey: dimension.key,
        name,
        aliases,
        writtenAs,
        areaId: dimension.areaId,
        definitionRefs: [],
        action: 'create',
        base: null,
        capacity: 'owner',
      })
    })
    if (findings.length)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: findings[0]!.message,
        data: { findings },
      })
    await keys(values)
    const added = values.map(({ key, name }) => ({ key, name }))
    const capacity = await capacityIn(tx, dimension.areaId)
    if (capacity) {
      const recorded = await recordTermVersions(
        tx,
        values.map((value) => ({ ...value, capacity })),
        { channel: 'form', reason: REASON },
      )
      const edition = await publishEdition(
        tx,
        { reason: 'vocabulary_changed', vocabulary: recorded.versions },
        dimension.areaId,
      )
      await recorded.decided(edition.label)
      return { outcome: 'published', values: added, edition: edition.label }
    }
    // Anyone else's values wait for an owner of the dimension's domain, or an admin.
    const rows = JSON.stringify(
      values.map(({ action: _a, base: _b, capacity: _c, ...term }) => term),
    )
    const each = 'from jsonb_array_elements($1::jsonb) with ordinality as e(row, n)'
    const proposals = await tx.query<{ id: string; revision: number; areaId: string | null }>(
      `with versions as (
         insert into vocab_term_versions(term_key,version_no,name,aliases,written_as,area_id,parent_key,proposer_id,content_digest)
         select row->>'key',
                (select coalesce(max(version_no),0)+1 from vocab_term_versions where term_key=row->>'key'),
                row->>'name',array(select jsonb_array_elements_text(row->'aliases')),
                array(select jsonb_array_elements_text(row->'writtenAs')),row->>'areaId',
                row->>'parentKey',cl_person(),decode($2::jsonb->>(row->>'key'),'hex')
           ${each}
         returning id,term_key)
       insert into proposals(subject,action,state,area_id,proposer_id,channel,vocab_version_id,draft,submitted_at)
       select 'vocabulary','create','submitted',row->>'areaId',cl_person(),'form',v.id,
              row||jsonb_build_object('base',null),now()
         ${each} join versions v on v.term_key=row->>'key' order by n
       returning id::text,revision,area_id as "areaId"`,
      [rows, JSON.stringify(Object.fromEntries(await digests(values)))],
    )
    await proposalEvents(
      tx,
      proposals.map((p) => ({
        p: { id: p.id, areaId: p.areaId, state: 'submitted', revision: p.revision },
        kind: 'submitted',
      })),
    )
    return { outcome: 'waiting', values: added, edition: null }
  }

  /** The values that wait for an owner and that the person may publish, oldest first. */
  async function waitingRows(): Promise<WaitingRow[]> {
    return tx.query<WaitingRow>(
      `select p.id::text,v.term_key as key,v.name,v.aliases,v.written_as as "writtenAs",
              jsonb_build_object('key',v.parent_key,'name',coalesce(d.name,v.parent_key)) as dimension,
              p.area_id as "areaId",
              jsonb_build_object('personId',p.proposer_id::text,'name',pe.display_name) as by,
              to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
              v.id::text as "versionId",p.revision
         from proposals p join vocab_term_versions v on v.id=p.vocab_version_id
         join vocab_terms t on t.key=v.term_key
         left join people pe on pe.id=p.proposer_id
         left join lateral (select dv.name from vocab_term_service ds
                              join vocab_term_versions dv on dv.id=ds.version_id
                             where ds.term_key=v.parent_key
                               and ds.editions @> (select seq from live_edition)) d on true
        where p.subject='vocabulary' and p.state='submitted' and t.kind='dimension_value'
          and (cl_is_admin_now() or (p.area_id is not null and cl_is_owner_now(p.area_id)))
        order by p.submitted_at,p.id`,
    )
  }

  async function waiting(): Promise<WaitingValue[]> {
    return (await waitingRows()).map(({ versionId: _v, revision: _r, ...value }) => value)
  }

  /**
   * Publishes waiting values and leaves others out, as the Names card decides them: published ones
   * in `edition` when the caller publishes one, else in an edition of their own.
   */
  async function decide(input: { accept: readonly string[]; leaveOut: readonly string[] }) {
    if (!input.accept.length && !input.leaveOut.length) return { versions: [], decided: noEvents }
    const rows = new Map((await waitingRows()).map((row) => [row.id, row]))
    const found = (id: string) => {
      const row = rows.get(id)
      if (!row)
        throw new ORPCError('CONFLICT', {
          message: 'A value here no longer waits. Look at the latest list, then try again.',
        })
      return row
    }
    // Two people can suggest the same value: the first is published, and the others are settled.
    const accepted = [
      ...new Map(input.accept.map(found).map((row) => [row.key, row] as const)).values(),
    ]
    const left = input.leaveOut.map(found)
    if (new Set([...input.accept, ...input.leaveOut]).size !== input.accept.length + left.length)
      throw new ORPCError('CONFLICT', { message: 'Publish a value or leave it out, not both.' })
    const decisions = [
      ...accepted.map((row) => ({ row, outcome: 'accept' as const })),
      ...left.map((row) => ({ row, outcome: 'reject' as const })),
    ]
    const made = await tx.query<{ id: string; proposalId: string; capacity: string }>(
      `insert into decisions(proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason)
       select (e->>'id')::uuid,(e->>'versionId')::uuid,e->>'areaId',cl_person(),
              case when e->>'areaId' is not null and cl_is_owner_now(e->>'areaId')
                   then 'owner' else 'administrator' end::decision_capacity,
              (e->>'outcome')::decision_outcome,$2
         from jsonb_array_elements($1::jsonb) e
       returning id::text,proposal_id::text as "proposalId",capacity::text`,
      [
        JSON.stringify(decisions.map(({ row, outcome }) => ({ ...row, outcome }))),
        'Decided on the Names card.',
      ],
    )
    const decisionOf = new Map(made.map((d) => [d.proposalId, d]))
    await tx.query(
      `update proposals set state=case when id=any($1::uuid[]) then 'accepted' else 'rejected' end::proposal_state,
              closed_at=now()
        where id=any($1::uuid[]) or id=any($2::uuid[])`,
      [accepted.map((row) => row.id), left.map((row) => row.id)],
    )
    await closeSettled(accepted.map((row) => row.key))
    const events = (edition: string | null) =>
      proposalEvents(
        tx,
        decisions.map(({ row, outcome }) => ({
          p: {
            id: row.id,
            areaId: row.areaId,
            state: outcome === 'accept' ? 'accepted' : 'rejected',
            revision: row.revision,
          },
          kind: 'decided',
          data: {
            decisionId: decisionOf.get(row.id)?.id,
            outcome,
            capacity: decisionOf.get(row.id)?.capacity,
            reason: 'Decided on the Names card.',
            ...(outcome === 'accept' && edition ? { edition } : {}),
          },
          audit: `decision.${outcome}`,
        })),
      )
    return { versions: accepted.map((row) => row.versionId), decided: events }
  }

  /**
   * The values an item's suggestion adds, published with it (`versions` go in the item's
   * edition): each takes the item's domain, decided in the capacity the item is. Keys taken since
   * by a published value are that value. Waiting values of the same keys are settled.
   */
  async function withItem(
    newValues: NewValues,
    scope: Draft['scope'],
    options: { areaId: string; capacity: 'owner' | 'administrator' },
  ) {
    const named = newValues.map((value) => value.key)
    if (!named.length) return { versions: [] as string[], decided: noEvents }
    const live = new Set(
      (
        await tx.query<{ key: string }>(
          `select term_key as key from vocab_term_service
            where editions @> (select seq from live_edition) and term_key=any($1::text[])`,
          [named],
        )
      ).map((row) => row.key),
    )
    const added = addedValues({ ...(scope ? { scope } : {}), newValues }, live)
    if (!added.length) return { versions: [] as string[], decided: noEvents }
    await keys(added)
    const recorded = await recordTermVersions(
      tx,
      added.map((value) => ({
        key: value.key,
        kind: 'dimension_value',
        parentKey: dimensionOfValue(value.key),
        name: value.name,
        aliases: [],
        writtenAs: [],
        areaId: options.areaId,
        definitionRefs: [],
        action: 'create',
        base: null,
        capacity: options.capacity,
      })),
      { channel: 'form', reason: 'Published with a context item.' },
    )
    await closeSettled(added.map((value) => value.key))
    return { versions: recorded.versions, decided: recorded.decided }
  }

  return { add, waiting, decide, withItem, keys, closeSettled }
}

/** Each value's content digest by key, as its version stores it. */
const digests = (values: readonly TermVersion[]) =>
  Promise.all(
    values.map(
      async (value) => [value.key, await contentDigest(termDigestContent(value))] as const,
    ),
  )
