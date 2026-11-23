import { contentDigest } from '../../../domain/canonical.ts'
import { termDigestContent, type Term } from '../../../domain/vocabulary.ts'
import type { Queryable } from '../../db/database.ts'
import { publishEdition, type EditionChange } from '../editions/index.ts'
import { proposalEvents } from './records.ts'

/** A term as a new version of it says it, and who accepts it in what capacity. */
export type TermVersion = Pick<
  Term,
  'key' | 'kind' | 'parentKey' | 'name' | 'aliases' | 'areaId' | 'definitionRefs'
> & {
  /** A new term, or a new version of a live one. */
  action: 'create' | 'change'
  /** The version it changes, by id; null when the proposal names none. */
  base: string | null
  capacity: 'owner' | 'administrator'
}

/**
 * Stores new versions of terms the way every vocabulary change goes (FR-125): a term version, an
 * accepted proposal, a decision by an owner of its domain or an administrator, which the database
 * checks, and an edition that serves them all. The terms must exist already. `change` says what
 * else the same edition does, such as taking a family out of service.
 */
export async function acceptTermVersions(
  tx: Queryable,
  terms: readonly TermVersion[],
  options: {
    channel: 'form' | 'import'
    reason: string
    /** The import the names came from, for a read's names. */
    batch?: string
    change?: Omit<EditionChange, 'vocabulary' | 'reason'>
    /** The domain the edition is announced to; null for none. */
    areaId: string | null
    /** Versions served again as they were, by id, such as a family's when it is joined again. */
    serveAgain?: readonly string[]
  },
) {
  const rows = JSON.stringify(
    await Promise.all(
      terms.map(async ({ action, base, capacity, ...term }) => ({
        ...term,
        digest: await contentDigest(termDigestContent(term)),
        action,
        capacity,
        draft: { ...term, base },
      })),
    ),
  )
  const each = 'from jsonb_array_elements($1::jsonb) with ordinality as e(row, n)'
  const versions = await tx.query<{ id: string; key: string }>(
    `insert into vocab_term_versions(term_key,version_no,name,aliases,area_id,parent_key,proposer_id,content_digest)
     select row->>'key',
            (select coalesce(max(version_no),0)+1 from vocab_term_versions where term_key=row->>'key'),
            row->>'name',array(select jsonb_array_elements_text(row->'aliases')),row->>'areaId',
            row->>'parentKey',null,decode(row->>'digest','hex')
       ${each} order by n
     returning id::text,term_key as key`,
    [rows],
  )
  const versionOf = JSON.stringify(Object.fromEntries(versions.map((v) => [v.key, v.id])))
  await tx.query(
    `insert into vocab_term_refs(version_id,definition_ref)
     select (($2::jsonb)->>(row->>'key'))::uuid,jsonb_array_elements_text(row->'definitionRefs') ${each}`,
    [rows, versionOf],
  )
  const proposals = await tx.query<{ id: string; revision: number; areaId: string | null }>(
    `insert into proposals(subject,action,state,area_id,proposer_id,channel,vocab_version_id,draft,reason,submitted_at,closed_at,import_batch_id)
     select 'vocabulary',(row->>'action')::proposal_action,'accepted',row->>'areaId',cl_person(),$5::creation_channel,
            (($2::jsonb)->>(row->>'key'))::uuid,row->'draft',$3,now(),now(),$4::uuid
       ${each} order by n
     returning id::text,revision,area_id as "areaId"`,
    [rows, versionOf, options.reason, options.batch ?? null, options.channel],
  )
  const decisions = await tx.query<{ id: string; proposalId: string; capacity: string }>(
    `insert into decisions(proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason)
     select p.id,p.vocab_version_id,p.area_id,cl_person(),c.capacity,'accept',$2
       from proposals p
       join (select (($3::jsonb)->>(e.row->>'key'))::uuid as version_id,
                    (e.row->>'capacity')::decision_capacity as capacity
               from jsonb_array_elements($1::jsonb) as e(row)) c on c.version_id=p.vocab_version_id
      where p.id=any($4::uuid[])
     returning id::text,proposal_id::text as "proposalId",capacity::text`,
    [rows, options.reason, versionOf, proposals.map((p) => p.id)],
  )
  const decisionOf = new Map(decisions.map((d) => [d.proposalId, d]))
  const edition = await publishEdition(
    tx,
    {
      reason: 'vocabulary_changed',
      ...options.change,
      vocabulary: [...versions.map((v) => v.id), ...(options.serveAgain ?? [])],
    },
    options.areaId,
  )
  await proposalEvents(
    tx,
    proposals.map((p) => ({
      p: { id: p.id, areaId: p.areaId, state: 'accepted', revision: p.revision },
      kind: 'decided',
      data: {
        decisionId: decisionOf.get(p.id)?.id,
        outcome: 'accept',
        capacity: decisionOf.get(p.id)?.capacity,
        reason: options.reason,
        edition: edition.label,
      },
      audit: 'decision.accept',
    })),
  )
  return edition
}
