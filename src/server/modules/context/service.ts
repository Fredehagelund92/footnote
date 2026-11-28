import { ORPCError } from '@orpc/client'
import type {
  DeletedDraft,
  DraftFromText,
  ItemBulkInput,
  ItemBulkResult,
  ItemChange,
  ItemPage,
  ItemVersionEntry,
  PublishItemResult,
  RelatedContext,
  SavedDraft,
} from '../../../contract/context.ts'
import { deriveAgentDraft } from '../../../domain/agent-draft.ts'
import { titleOfWords } from '../../../domain/questions.ts'
import {
  changeAction,
  changeSummary,
  planBulk,
  PUBLISH_MAX,
  publishesNow,
  publishSummary,
  type BulkInput,
  type BulkPerson,
  type BulkRow,
  type BulkRowSkip,
} from '../../../domain/context-bulk.ts'
import type { Draft } from '../../../domain/draft.ts'
import type { NewValues } from '../../../domain/values.ts'
import { limits } from '../../../domain/proposal-rules.ts'
import type { Scope } from '../../../domain/item.ts'
import type { ItemVersion } from '../../../domain/item-version.ts'
import { termDomain } from '../../../domain/catalogue.ts'
import { related } from '../../../domain/links.ts'
import type { ClashRelation } from '../../../domain/readiness.ts'
import { kinds, type Kind } from '../../../domain/words.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { liveSeq, standingSplits } from '../../db/family-splits.ts'
import { undoOffer } from '../../db/undo.ts'
import { liveServingBundle, type BundleCache } from '../answer/index.ts'
import { conflictsOfItem } from '../conflicts/index.ts'
import { createGapsService } from '../gaps/index.ts'
import type { LibraryService } from '../library/index.ts'
import { draftVocabulary } from '../../mcp/draft-session.ts'
import {
  changeReason,
  checkDraft,
  proposalEvent,
  readVersions,
  rejectSensitive,
  type ProposalsService,
} from '../proposals/index.ts'
import { draftOf, type ReviewPath, type ReviewService } from '../review/index.ts'
import { linkRefusal, pastedLink, type PageRead } from '../web/index.ts'
import { missing, notAllowed, signedOutKept } from '../../../contract/refusals.ts'

/**
 * Context for people (docs/product.md, section 3): a context item's page and its history, the
 * items a person opened, changes to many items at once (FR-139), restoring a version as a draft
 * (FR-140), related context, publishing in one step as an owner (FR-137), a draft from pasted
 * text or a link, and the drafts that were deleted.
 *
 * Every change goes through the paths that already guard it: an archive is a retire decision, a
 * move or a new kind is a change its owner publishes, a check is a recheck, a deletion discards a
 * draft. A change to many items records one item_changes row, and its Undo takes back exactly
 * what it did, within limits.undo_seconds, by its maker only.
 */
export type ContextDeps = {
  library: LibraryService
  proposals: ProposalsService
  review: ReviewService
  path: ReviewPath
}

/** The words a change records as its reason, where the rules ask for one. */
const reasons = {
  archive: 'Archived from the Context list.',
  publish: 'Published from the Context list.',
  unsent: 'Undone from the Context list: back to a draft.',
  check: 'Checked from the Context list: still true.',
  restored: (version: number) => `Restored from version ${version}.`,
}

const kindName = (kind: string) => kinds[kind as Kind].label
const isItemId = (id: string) => /^itm_[a-z0-9]{8,16}$/.test(id)
/** Why the checks refused a draft, in their first sentence; '' for any other failure. */
function notReady(error: unknown) {
  if (!(error instanceof ORPCError) || error.code !== 'UNPROCESSABLE_CONTENT') return ''
  const data = error.data as { findings?: { severity: string; message: string }[] } | undefined
  return data?.findings?.find((f) => f.severity === 'error')?.message ?? error.message
}
const plainError = (error: unknown) =>
  error instanceof ORPCError ? error.message : "It couldn't be changed."

/** What Undo of a change needs, kept with it. */
type UndoRecord = {
  /** Decisions it made: archives, publishes of a move or a kind, checks. */
  decisions?: string[]
  /** Drafts it deleted. */
  drafts?: string[]
  /** The owners each item had before, by item. */
  owners?: Record<string, string[]>
  /** Drafts it sent, published or to the owners: Undo makes them drafts again, their writers'. */
  sent?: string[]
}

export function createContextService(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  { library, proposals, review, path }: ContextDeps,
) {
  async function person(id: string | null): Promise<BulkPerson | null> {
    const [row] = await tx.query<BulkPerson>(
      `select p.id::text, p.display_name as name, cl_is_admin(p.id, now()) as admin,
              coalesce((select array_agg(a.area_id order by a.area_id) from area_assignments a
                         where a.person_id = p.id and a.role = 'owner' and a.valid_at @> now()), '{}') as owns
         from people p
        where p.id = coalesce($1::uuid, cl_person()) and p.deactivated_at is null and p.erased_at is null`,
      [id],
    )
    return row ?? null
  }
  async function me(): Promise<BulkPerson> {
    const found = await person(null)
    if (!found) throw new ORPCError('UNAUTHORIZED', { message: signedOutKept })
    return found
  }
  async function domainNames(): Promise<(id: string) => string> {
    const rows = await tx.query<{ id: string; name: string }>('select id, name from areas')
    const names = new Map(rows.map((r) => [r.id, r.name]))
    return (id) => names.get(id) ?? id
  }
  async function domainOwners(areaId: string): Promise<string[]> {
    const rows = await tx.query<{ id: string }>(
      `select a.person_id::text as id from area_assignments a join people p on p.id = a.person_id
        where a.area_id = $1 and a.role = 'owner' and a.valid_at @> now()
          and p.deactivated_at is null and p.erased_at is null
        order by a.person_id`,
      [areaId],
    )
    return rows.map((r) => r.id)
  }

  /**
   * The rows of a change, as the rule reads them, in the order asked: published items the person
   * may read, and their own drafts, the only ones row security lets them see (FR-139). A row that
   * is neither is not found.
   */
  async function rowsOf(ids: readonly string[]): Promise<{ rows: BulkRow[]; missing: string[] }> {
    const itemIds = ids.filter(isItemId)
    const draftIds = ids.filter((id) => !isItemId(id))
    const items = await tx.query<Omit<BulkRow, 'owners'> & { own: string[] }>(
      `select i.id, i.title, i.kind::text as kind, i.area_id as "areaId",
              case when i.status = 'accepted' then 'live' else 'archived' end as status,
              coalesce((select array_agg(o.person_id::text order by o.person_id) from item_owners o
                         where o.item_id = i.id), '{}') as own
         from v_item_list i
        where i.id = any($1::text[]) and cl_audience_allows(i.audience_groups)`,
      [itemIds],
    )
    const drafts = await tx.query<Omit<BulkRow, 'owners'>>(
      `select p.id::text, coalesce(nullif(p.draft->>'title', ''), 'Untitled draft') as title,
              coalesce(p.draft->>'kind', 'note') as kind, p.area_id as "areaId", 'draft' as status,
              p.proposer_id::text as writer
         from proposals p
        where p.id = any($1::uuid[]) and p.subject = 'item' and p.state = 'draft'
          and p.discarded_at is null and p.area_id is not null`,
      [draftIds],
    )
    const owners = new Map<string, string[]>()
    for (const area of new Set([...items, ...drafts].map((r) => r.areaId)))
      owners.set(area, await domainOwners(area))
    const byId = new Map<string, BulkRow>([
      ...items.map(({ own, ...row }): [string, BulkRow] => [
        row.id,
        { ...row, owners: own.length ? own : (owners.get(row.areaId) ?? []) },
      ]),
      ...drafts.map((row): [string, BulkRow] => [
        row.id,
        { ...row, owners: owners.get(row.areaId) ?? [] },
      ]),
    ])
    const rows: BulkRow[] = []
    const missing: string[] = []
    for (const id of new Set(ids)) {
      const row = byId.get(id)
      if (row) rows.push(row)
      else missing.push(id)
    }
    return { rows, missing }
  }

  async function opened(ids: readonly string[]): Promise<Set<string>> {
    const rows = await tx.query<{ id: string }>(
      'select item_id as id from item_reads where person_id = cl_person() and item_id = any($1::text[])',
      [ids],
    )
    return new Set(rows.map((r) => r.id))
  }

  /** The input as the rule reads it, refused when it names what does not exist or may not be used. */
  async function inputOf(input: ItemBulkInput, mine: BulkPerson): Promise<BulkInput> {
    const read: BulkInput = { action: input.action }
    if (input.action === 'domain') {
      if (!input.areaId)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Choose a domain to move them to.',
        })
      const [area] = await tx.query<{ name: string }>(
        'select name from areas where id = $1 and archived_at is null',
        [input.areaId],
      )
      if (!area)
        throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Choose a domain that exists.' })
      if (!mine.admin && !mine.owns.includes(input.areaId))
        throw new ORPCError('FORBIDDEN', {
          message: `Only owners of ${area.name} and admins can move context into it.`,
        })
      read.areaId = input.areaId
    }
    if (input.action === 'kind') {
      if (!input.kind)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Choose the kind to change them to.',
        })
      read.kind = input.kind
    }
    if (input.action === 'owner_add' || input.action === 'owner_set') {
      const owner = input.personId ? await person(input.personId) : null
      if (!owner)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Choose someone in the workspace.',
        })
      read.person = owner
    }
    return read
  }

  const notFound = (id: string): BulkRowSkip => ({
    id,
    title: '',
    code: 'not_found',
    why: 'not found',
    message: "You can't see it any more.",
  })

  const publishedAlready = ({ id, title }: { id: string; title: string }): BulkRowSkip => ({
    id,
    title,
    code: 'published',
    why: 'published',
    message: 'It is published already.',
  })

  /** The person's own drafts among `ids` that a Publish has since taken: published, by this or an earlier press. */
  async function publishedDrafts(ids: readonly string[]) {
    if (!ids.length) return []
    return tx.query<{ id: string; title: string }>(
      `select p.id::text, coalesce(nullif(p.draft->>'title', ''), 'Untitled draft') as title
         from proposals p
        where p.id = any($1::uuid[]) and p.subject = 'item' and p.state = 'accepted'
          and p.proposer_id = cl_person()`,
      [ids],
    )
  }

  async function plan(input: ItemBulkInput) {
    const mine = await me()
    const read = await inputOf(input, mine)
    if (input.action === 'publish' && new Set(input.rows).size > PUBLISH_MAX)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: `Publish up to ${PUBLISH_MAX} drafts at once. Tick fewer, then publish the rest.`,
      })
    const { rows, missing } = await rowsOf(input.rows)
    const names = await domainNames()
    const result = planBulk(rows, read, mine, {
      opened: await opened(rows.map((r) => r.id)),
      domainName: names,
    })
    // A draft that was published since the list was read is done already, not gone.
    const already =
      input.action === 'publish' ? await publishedDrafts(missing.filter((id) => !isItemId(id))) : []
    const gone = missing.filter((id) => !already.some((a) => a.id === id))
    return {
      mine,
      read,
      names,
      act: result.act,
      skipped: [...gone.map(notFound), ...already.map(publishedAlready), ...result.skipped],
    }
  }

  /**
   * Publishes a change to a live item as its owner in one step: a change made from the live
   * version with `patch`, submitted, checked and published. Returns the decision it made.
   */
  async function publishChange(itemId: string, patch: Draft): Promise<string> {
    const created = await proposals.create({ itemId, draft: patch })
    const submitted = await proposals.submit(created.id, created.revision)
    await review.checkSubmitted(submitted.id)
    const current = await proposals.get(submitted.id)
    const published = await path.publish({ id: current.id, revision: current.revision })
    return published.undo.token.slice('decision:'.length)
  }

  /**
   * Points a live item about a family that was split back into its metrics at each of them
   * (FR-142), published by its owner in one step: the ready change its Inbox card offers, which
   * ends the flag the split raised. Returns the decision, or null when it is about no such family.
   */
  async function pointAtSplitMetrics(itemId: string): Promise<string | null> {
    const [live] = await tx.query<{ scope: Scope; splits: { key: string; variants: string[] }[] }>(
      `select jsonb_build_object(
                'metrics', coalesce((select jsonb_agg(m.metric_key order by m.metric_key)
                                       from item_version_metrics m where m.version_id = s.version_id), '[]'),
                'dimensions', coalesce((select jsonb_agg(d.dimension_key order by d.dimension_key)
                                          from item_version_dimensions d where d.version_id = s.version_id), '[]'),
                'dimensionValues', coalesce((select jsonb_agg(jsonb_build_object('dimension', d.dimension_key,
                                                'value', d.value_key) order by d.value_key)
                                               from item_version_dimension_values d
                                              where d.version_id = s.version_id), '[]')) as scope,
              coalesce((select jsonb_agg(jsonb_build_object('key', x.family_key, 'variants', x.variants))
                          from item_version_metrics m
                          join ${standingSplits(liveSeq)} x on x.family_key = m.metric_key
                         where m.version_id = s.version_id), '[]') as splits
         from item_version_service s
        where s.item_id = $1 and s.editions @> (select seq from live_edition)`,
      [itemId],
    )
    if (!live?.splits.length) return null
    const metrics = [
      ...new Set(
        live.scope.metrics.flatMap(
          (key) => live.splits.find((split) => split.key === key)?.variants ?? [key],
        ),
      ),
    ]
    return publishChange(itemId, { scope: { ...live.scope, metrics } })
  }

  async function lastDecision(itemId: string, outcome: 'retire' | 'accept'): Promise<string> {
    const [row] = await tx.query<{ id: string }>(
      `select d.id::text from decisions d join item_versions v on v.id = d.item_version_id
        where v.item_id = $1 and d.decided_by = cl_person() and d.outcome::text = $2
        order by d.decided_at desc, d.id desc limit 1`,
      [itemId, outcome],
    )
    if (!row) throw new Error('The decision was not recorded')
    return row.id
  }

  async function ownersBefore(itemId: string): Promise<string[]> {
    const rows = await tx.query<{ id: string }>(
      'select person_id::text as id from item_owners where item_id = $1 order by person_id',
      [itemId],
    )
    return rows.map((r) => r.id)
  }

  async function setOwners(itemId: string, owners: readonly string[]) {
    await tx.query('delete from item_owners where item_id = $1', [itemId])
    for (const owner of owners)
      await tx.query(
        'insert into item_owners (item_id, person_id, added_by) values ($1, $2, cl_person())',
        [itemId, owner],
      )
  }

  /**
   * The person's own draft published as from the editor: sent, through the checks, and published
   * at once where they own its domain or are an admin. Anywhere else it waits for the domain's
   * owners.
   */
  async function publishDraft(row: BulkRow, mine: BulkPerson, undo: UndoRecord) {
    const [draft] = await tx.query<{ revision: number }>(
      'select revision from proposals where id = $1',
      [row.id],
    )
    const submitted = await proposals.submit(row.id, draft!.revision)
    await review.checkSubmitted(submitted.id)
    ;(undo.sent ??= []).push(row.id)
    if (!publishesNow(row, mine)) return
    const current = await proposals.get(submitted.id)
    // The editor's rule: an overlap nobody answered is unrelated.
    const published = await path.publish(
      { id: current.id, revision: current.revision, reason: reasons.publish },
      { clashesOnly: true },
    )
    ;(undo.decisions ??= []).push(published.undo.token.slice('decision:'.length))
  }

  /** One row of a change, done in full or not at all; what Undo needs goes into `undo`. */
  async function applyRow(row: BulkRow, read: BulkInput, mine: BulkPerson, undo: UndoRecord) {
    switch (read.action) {
      case 'publish':
        await publishDraft(row, mine, undo)
        return
      case 'archive':
        await review.retire(row.id, reasons.archive)
        ;(undo.decisions ??= []).push(await lastDecision(row.id, 'retire'))
        return
      case 'delete': {
        const [draft] = await tx.query<{ revision: number }>(
          'select revision from proposals where id = $1',
          [row.id],
        )
        await proposals.discard(row.id, draft!.revision)
        ;(undo.drafts ??= []).push(row.id)
        return
      }
      case 'domain': {
        const to = read.areaId!
        const before = await ownersBefore(row.id)
        const fits = await tx.query<{ id: string }>(
          `select person_id::text as id from unnest($1::uuid[]) as o(person_id)
            where cl_is_admin(person_id, now()) or cl_has_area_role(person_id, $2, 'owner', now())`,
          [before, to],
        )
        const owner = mine.owns.includes(to) ? mine.id : (await domainOwners(to))[0]
        ;(undo.decisions ??= []).push(
          await publishChange(row.id, { areaId: to, ...(owner ? { ownerId: owner } : {}) }),
        )
        // Its own owners go with it only where they own the new domain too.
        const kept = fits.map((f) => f.id)
        if (kept.length !== before.length) {
          ;(undo.owners ??= {})[row.id] = before
          await setOwners(row.id, kept)
        }
        return
      }
      case 'kind':
        ;(undo.decisions ??= []).push(await publishChange(row.id, { kind: read.kind! }))
        return
      case 'owner_add':
      case 'owner_set': {
        const before = await ownersBefore(row.id)
        ;(undo.owners ??= {})[row.id] = before
        const who = read.person!.id
        // Adding to a domain's owners names them too, so the item keeps everyone who answered for it.
        const start = before.length ? before : row.owners.filter((o) => o !== who)
        await setOwners(row.id, read.action === 'owner_set' ? [who] : [...start, who])
        return
      }
      case 'check': {
        const pointed = await pointAtSplitMetrics(row.id)
        if (pointed) {
          ;(undo.decisions ??= []).push(pointed)
          return
        }
        const checked = await review.recheck(row.id, reasons.check)
        const [decision] = await tx.query<{ id: string }>(
          `select id::text from decisions where proposal_id = $1 order by decided_at desc, id desc limit 1`,
          [checked.proposal.id],
        )
        ;(undo.decisions ??= []).push(decision!.id)
        return
      }
    }
  }

  async function bulkApply(input: ItemBulkInput): Promise<ItemBulkResult> {
    const { mine, read, names, act, skipped } = await plan(input)
    const done: BulkRow[] = []
    const failed: ItemBulkResult['failed'] = []
    const undo: UndoRecord = {}
    const sent: string[] = []
    for (const row of act) {
      await tx.query('savepoint item_change')
      // What Undo needs for this row joins the change's only once the row is done.
      const own: UndoRecord = {}
      try {
        await applyRow(row, read, mine, own)
        await tx.query('release savepoint item_change')
        done.push(row)
        undo.decisions = [...(undo.decisions ?? []), ...(own.decisions ?? [])]
        undo.drafts = [...(undo.drafts ?? []), ...(own.drafts ?? [])]
        undo.owners = { ...undo.owners, ...own.owners }
        undo.sent = [...(undo.sent ?? []), ...(own.sent ?? [])]
        if (read.action === 'publish' && !publishesNow(row, mine)) sent.push(row.id)
      } catch (error) {
        await tx.query('rollback to savepoint item_change')
        // A draft the checks refuse is left alone with their reason, as the editor says it.
        const refused = read.action === 'publish' ? notReady(error) : ''
        if (refused)
          skipped.push({
            id: row.id,
            title: row.title,
            code: 'not_ready',
            why: 'not ready',
            message: refused,
          })
        else failed.push({ id: row.id, title: row.title, message: plainError(error) })
      }
    }
    if (!done.length) return { done: [], sent: [], skipped, failed, change: null, undo: null }
    const summary =
      read.action === 'publish'
        ? publishSummary(
            done.filter((r) => !sent.includes(r.id)).map((r) => r.title),
            done.filter((r) => sent.includes(r.id)).map((r) => r.title),
          )
        : changeSummary(
            read,
            done.map((r) => r.title),
            names,
          )
    const [change] = await tx.query<{ id: string }>(
      `insert into item_changes (action, made_by, summary, items, undo)
       values ($1, cl_person(), $2, $3, $4) returning id::text`,
      [
        changeAction[read.action],
        summary,
        JSON.stringify(done.map((r) => ({ id: r.id, title: r.title, areaId: r.areaId }))),
        JSON.stringify(undo),
      ],
    )
    return {
      done: done.map((r) => r.id),
      sent,
      skipped,
      failed,
      change: { id: change!.id, summary },
      undo: await undoOffer(tx, `change:${change!.id}`),
    }
  }

  /**
   * Takes back one change to many items, by its maker within the window: its decisions are undone
   * in one edition, its drafts come back, and each item's owners are what they were.
   */
  async function undoChange(id: string): Promise<{ edition: string | null }> {
    const [change] = await tx.query<{ undo: UndoRecord; mine: boolean; undone: boolean }>(
      `select undo, made_by = cl_person() as mine, undone_at is not null as undone
         from item_changes where id = $1::uuid`,
      [id],
    )
    if (!change) throw new ORPCError('NOT_FOUND', { message: missing('this change') })
    if (!change.mine)
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the person who made the change can undo it.',
      })
    if (change.undone)
      throw new ORPCError('CONFLICT', { message: 'This change is already undone.' })
    const [marked] = await tx.query<{ id: string }>(
      'update item_changes set undone_at = now() where id = $1::uuid returning id::text',
      [id],
    )
    if (!marked)
      throw new ORPCError('CONFLICT', {
        message: 'It is too late to undo this change. Change them again instead.',
      })
    const { decisions = [], drafts = [], owners = {}, sent = [] } = change.undo
    // The decisions first: a move undone puts each item back in its domain, where its owners were.
    const undone = decisions.length ? await path.undoDecisions(decisions) : { edition: null }
    // Each draft it sent is a draft again, its writer's, with its words: the suggestion is
    // withdrawn and its draft comes back beside it, as a check undone goes.
    for (const sentId of sent) {
      const [withdrawn] = await tx.query<Parameters<typeof proposalEvent>[1]>(
        `update proposals set state = 'withdrawn', closed_at = now(), reason = $2
          where id = $1 and state in ('submitted', 'in_review')
          returning id::text, area_id as "areaId", state::text as state, revision`,
        [sentId, reasons.unsent],
      )
      if (!withdrawn) continue
      await proposalEvent(tx, withdrawn, 'withdrawn', { reason: reasons.unsent })
      // An imported draft comes back as one of its import, so its writer's Inbox still counts it,
      // and a source's keeps the read it came from.
      const [back] = await tx.query<Parameters<typeof proposalEvent>[1]>(
        `insert into proposals (subject, action, area_id, item_id, proposer_id, channel, draft,
                                draft_saved_at, provenance, agent_id, agent_name, base_version_id,
                                import_batch_id, source_id, source_read_id, source_document_id)
         select subject, action, area_id, case when action = 'change' then item_id end,
                proposer_id, channel, draft, now(), provenance, agent_id, agent_name, base_version_id,
                import_batch_id, source_id, source_read_id, source_document_id
           from proposals where id = $1
         returning id::text, area_id as "areaId", state::text as state, revision`,
        [sentId],
      )
      await proposalEvent(tx, back!, 'restored', { change: id, from: sentId })
    }
    for (const [itemId, before] of Object.entries(owners)) await setOwners(itemId, before)
    for (const draft of drafts) {
      const [back] = await tx.query<Parameters<typeof proposalEvent>[1]>(
        `update proposals set discarded_at = null where id = $1
         returning id::text, area_id as "areaId", state::text as state, revision`,
        [draft],
      )
      if (back) await proposalEvent(tx, back, 'restored', { change: id })
    }
    return undone
  }

  async function markRead(id: string) {
    if (!(await library.getIndexRow(id)))
      throw new ORPCError('NOT_FOUND', { message: missing('this context item') })
    await tx.query(
      `insert into item_reads (person_id, item_id) values (cl_person(), $1)
       on conflict (person_id, item_id) do update set read_at = now()`,
      [id],
    )
    return { read: true }
  }

  /** What one version changed against the one before it, as History says it. */
  function entryOf(
    before: ItemVersion | null,
    after: ItemVersion,
    recheck: boolean,
    names: (id: string) => string,
    readable: Set<string>,
  ): Pick<ItemVersionEntry, 'kind' | 'field' | 'before' | 'after'> | null {
    const none = { field: '', before: '', after: '' }
    if (!before) return { kind: 'published', ...none }
    if (recheck) return { kind: 'checked', ...none }
    if (before.areaId !== after.areaId)
      return {
        kind: 'moved',
        field: 'Domain',
        before: names(before.areaId),
        after: names(after.areaId),
      }
    if (before.kind !== after.kind)
      return {
        kind: 'retyped',
        field: 'Kind',
        before: kindName(before.kind),
        after: kindName(after.kind),
      }
    if (before.title !== after.title)
      return { kind: 'wording', field: 'Title', before: before.title, after: after.title }
    const text = (v: ItemVersion) => [v.summary, v.body ?? ''].filter(Boolean).join('\n\n')
    if (text(before) !== text(after))
      return { kind: 'wording', field: 'Text', before: text(before), after: text(after) }
    const dates = (v: ItemVersion) => `${v.validity.start} to ${v.validity.end ?? 'no end'}`
    if (dates(before) !== dates(after))
      return { kind: 'dates', field: 'When', before: dates(before), after: dates(after) }
    // A source with no link is its line: who or what says so.
    const source = (v: ItemVersion) => v.evidence.map((e) => e.url ?? e.quote).join('\n')
    if (source(before) !== source(after))
      return { kind: 'link', field: 'Source', before: source(before), after: source(after) }
    // A version that only set or removed the Conflict flag says so, not a wording change.
    const flags = (v: ItemVersion) =>
      v.conflicts
        .filter((c) => readable.has(c))
        .sort()
        .join('\n')
    if ([...before.conflicts].sort().join('\n') !== [...after.conflicts].sort().join('\n')) {
      if (flags(before) === flags(after)) return null
      return {
        kind: 'conflict',
        field: 'Disagrees with',
        before: flags(before),
        after: flags(after),
      }
    }
    return {
      kind: 'wording',
      field: "Don't conclude",
      before: before.notToConclude,
      after: after.notToConclude,
    }
  }

  /** An item's history, newest first: each version agents got, its archives and owner changes. */
  async function historyOf(itemId: string): Promise<ItemVersionEntry[]> {
    const day = (at: string) => `to_char(${at} at time zone 'UTC', 'YYYY-MM-DD')`
    const served = await tx.query<{
      id: string
      recheck: boolean
      by: string | null
      at: string
      agent: { name: string; personId: string } | null
      policy: { decisionId: string; undone: boolean; undoable: boolean } | null
    }>(
      `select v.id::text, v.is_recheck as recheck,
              (select d.decided_by::text from decisions d where d.item_version_id = v.id
                  and d.outcome = 'accept' order by d.decided_at, d.id limit 1) as by,
              (select jsonb_build_object('name', p.agent_name, 'personId', p.proposer_id::text)
                 from proposals p where p.item_version_id = v.id and p.agent_name is not null
                order by p.created_at limit 1) as agent,
              (select jsonb_build_object(
                        'decisionId', d.id::text,
                        'undone', exists (select 1 from decision_undos u where u.decision_id = d.id),
                        'undoable', not exists (select 1 from decision_undos u where u.decision_id = d.id)
                          and (cl_is_owner_now(d.area_id) or cl_is_admin_now())
                          and exists (select 1 from item_version_service s where s.version_id = v.id
                                         and s.editions @> (select seq from live_edition)))
                 from decisions d where d.item_version_id = v.id and d.outcome = 'accept'
                  and d.auto_policy_id is not null order by d.decided_at limit 1) as policy,
              coalesce((select min(e.created_at) from item_version_service s
                          join editions e on e.seq = lower(s.editions) where s.version_id = v.id),
                       v.created_at)::text as at
         from item_versions v
        where v.item_id = $1 and exists (select 1 from item_version_service s where s.version_id = v.id)
        order by v.version_no`,
      [itemId],
    )
    const contents = new Map(
      (
        await readVersions(
          tx,
          served.map((s) => s.id),
        )
      ).map((v) => [v.id, v]),
    )
    const names = await domainNames()
    const flagged = [...new Set([...contents.values()].flatMap((v) => v.version.conflicts))]
    const readable = new Set(
      flagged.length
        ? (
            await tx.query<{ id: string }>(
              'select i.id from v_item_list i where i.id = any($1::text[]) and cl_audience_allows(i.audience_groups)',
              [flagged],
            )
          ).map((r) => r.id)
        : [],
    )
    const dated: (ItemVersionEntry & { at: string })[] = []
    let previous: ItemVersion | null = null
    for (const s of served) {
      const stored = contents.get(s.id)
      if (!stored) continue
      const entry = entryOf(previous, stored.version, s.recheck, names, readable)
      previous = stored.version
      if (!entry) continue
      dated.push({
        version: stored.versionNo,
        personId: s.by,
        on: s.at.slice(0, 10),
        at: s.at,
        ...entry,
        restorable: ['published', 'wording', 'link', 'dates'].includes(entry.kind),
        ...(s.agent ? { agent: s.agent } : {}),
        ...(s.policy ? { policy: s.policy } : {}),
      })
    }
    const others = await tx.query<{
      kind: 'archived' | 'owners' | 'conflict'
      by: string
      on: string
      at: string
      summary: string
    }>(
      `select 'archived' as kind, d.decided_by::text as by, ${day('d.decided_at')} as on,
              d.decided_at::text as at, d.reason as summary
         from decisions d join item_versions v on v.id = d.item_version_id
        where v.item_id = $1 and d.outcome = 'retire'
          and not exists (select 1 from decision_undos u where u.decision_id = d.id)
       union all
       select 'owners', c.made_by::text, ${day('c.made_at')}, c.made_at::text,
              -- The sentence names a title: an item the reader may not see makes it a count.
              case when not exists (select 1 from jsonb_array_elements(c.items) e
                                     where not cl_item_open(e->>'id')) then c.summary
                   else 'Changed the owners of ' || jsonb_array_length(c.items) || ' items.' end
         from item_changes c
        where c.action = 'owners' and c.undone_at is null
          and c.items @> jsonb_build_array(jsonb_build_object('id', $1::text))
       union all
       -- A conflict settled with a reason is on both items' history (FR-220).
       select 'conflict', k.decided_by::text, ${day('k.decided_at')}, k.decided_at::text,
              case k.outcome when 'kept_one' then 'Settled a conflict: kept one, archived the other. '
                             when 'kept_both' then 'Kept both items of a conflict. '
                             else 'Not a conflict: the flag was removed. ' end
              || 'Reason: ' || k.reason || coalesce(' “' || k.quote || '”', '')
         from conflict_decisions k
        where k.undone_at is null and $1 in (k.holder_item_id, k.other_item_id)`,
      [itemId],
    )
    for (const o of others)
      dated.push({
        version: null,
        kind: o.kind,
        personId: o.by,
        on: o.on,
        at: o.at,
        field: '',
        before: '',
        after: o.summary,
        restorable: false,
      })
    return dated
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.version ?? 0) - (a.version ?? 0))
      .map(({ at: _at, ...entry }) => entry)
  }

  async function page(id: string): Promise<ItemPage | null> {
    const row = await library.getIndexRow(id)
    const item = row ? await library.getItem(id) : null
    if (!row || !item) return null
    const mine = await me()
    // The live items it is in a conflict with, either way round, from the live edition's own
    // tables: a page never builds the serving bundle, so it stays quick however many items there are.
    const pairs = await conflictsOfItem(tx, clock.today(), mine, id)
    return {
      item,
      lastChecked: row.lastChecked,
      trust: row.trust,
      check: row.check,
      chips: row.chips,
      owners: row.owners,
      history: await historyOf(id),
      canChange: mine.admin || mine.owns.includes(row.areaId),
      conflicts: pairs.map((p) => p.otherId),
      pairs,
    }
  }

  /**
   * Two versions of an item the person may read, by their numbers, as History compares them:
   * `from` shown as before, `to` as after. Only versions agents got are compared.
   */
  async function compare(input: { id: string; from: number; to: number }) {
    const row = await library.getIndexRow(input.id)
    if (!row) throw new ORPCError('NOT_FOUND', { message: missing('this context item') })
    const found = await tx.query<{ id: string; no: number }>(
      `select v.id::text, v.version_no as no from item_versions v
        where v.item_id = $1 and v.version_no = any($2::int[])
          and exists (select 1 from item_version_service s where s.version_id = v.id)`,
      [input.id, [input.from, input.to]],
    )
    const idOf = (no: number) => found.find((v) => v.no === no)?.id
    const [from, to] = [idOf(input.from), idOf(input.to)]
    if (!from || !to)
      throw new ORPCError('NOT_FOUND', { message: "We couldn't find that version." })
    return path.versionPair(from, to)
  }

  /** An earlier version's words as a new draft of a change, for an owner or an admin (FR-140). */
  async function restoreAsDraft(input: { id: string; version: number }) {
    const row = await library.getIndexRow(input.id)
    if (!row) throw new ORPCError('NOT_FOUND', { message: missing('this context item') })
    const mine = await me()
    if (!mine.admin && !mine.owns.includes(row.areaId))
      throw new ORPCError('FORBIDDEN', {
        message: 'Only an owner of its domain or an admin can restore an earlier version.',
      })
    if (row.status !== 'accepted')
      throw new ORPCError('CONFLICT', {
        message: "It is archived, so an earlier version can't come back as a change to it.",
      })
    const [version] = await tx.query<{ id: string }>(
      `select v.id::text from item_versions v
        where v.item_id = $1 and v.version_no = $2
          and exists (select 1 from item_version_service s where s.version_id = v.id)`,
      [input.id, input.version],
    )
    const stored = version ? (await readVersions(tx, [version.id]))[0] : undefined
    if (!stored) throw new ORPCError('NOT_FOUND', { message: "We couldn't find that version." })
    if (stored.versionNo === row.version)
      throw new ORPCError('CONFLICT', { message: 'This is the version agents get now.' })
    // The words, dates and sources of that version, in the domain and with the kind it has now.
    const {
      reviewDate: _due,
      changeMarks: _marks,
      references: _refs,
      replaces: _replaces,
      ...words
    } = draftOf(stored.version)
    const created = await proposals.create({
      itemId: input.id,
      draft: { ...words, areaId: row.areaId, kind: row.kind, ownerId: row.ownerId },
      reason: reasons.restored(input.version),
    })
    return { proposalId: created.id }
  }

  function reasonFor(text: string | undefined) {
    try {
      return text && [...text.trim()].length <= limits.changeReason
        ? changeReason(text, 'change')
        : undefined
    } catch {
      return undefined
    }
  }

  /**
   * The right words from a report in Ask (FR-622): the item as agents get it now, with the summary
   * the person wrote, sent to its owners as a suggestion that waits like any other, whoever sent
   * it. Null when the words are the summary it has already: there is nothing to suggest.
   */
  async function suggestWords(input: {
    itemId: string
    summary: string
    reason?: string | undefined
  }): Promise<string | null> {
    const row = await library.getIndexRow(input.itemId)
    if (!row) throw new ORPCError('NOT_FOUND', { message: missing('this context item') })
    if (row.status !== 'accepted')
      throw new ORPCError('CONFLICT', {
        message: 'It is archived, so it takes no suggestion. Send the report without new words.',
      })
    const summary = input.summary.trim()
    if ([...summary].length > limits.summary)
      throw new ORPCError('BAD_REQUEST', {
        message: `The right words fit in ${limits.summary} characters, as a summary does.`,
      })
    try {
      rejectSensitive(summary)
    } catch (error) {
      if (error instanceof ORPCError && error.code === 'UNPROCESSABLE_CONTENT')
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Take the email address, phone number or secret out of the right words.',
          data: error.data,
        })
      throw error
    }
    const [version] = await tx.query<{ id: string }>(
      `select v.id::text from item_versions v
        where v.item_id = $1 and v.version_no = $2
          and exists (select 1 from item_version_service s where s.version_id = v.id)`,
      [input.itemId, row.version],
    )
    const stored = version ? (await readVersions(tx, [version.id]))[0] : undefined
    if (!stored) throw new ORPCError('NOT_FOUND', { message: missing('this context item') })
    if (stored.version.summary.trim() === summary) return null
    // The words of the version agents get, with the person's summary in plain text: a mention it
    // had there goes with its words, and the owner sees that in the review.
    const {
      reviewDate: _due,
      changeMarks: _marks,
      references: _refs,
      replaces: _replaces,
      ...words
    } = draftOf(stored.version)
    const created = await proposals.create({
      itemId: input.itemId,
      version: row.version,
      draft: {
        ...words,
        summary,
        summaryMarkup: summary.replace(/[\\@]/g, '\\$&'),
        areaId: row.areaId,
        kind: row.kind,
        ownerId: row.ownerId,
      },
      reason: reasonFor(input.reason),
    })
    const checks = await checkDraft(
      tx,
      created.draft,
      created.proposerId,
      created.channel,
      created.itemId,
    )
    const errors = checks.findings.filter((f) => f.severity === 'error')
    if (!checks.version || errors.length) {
      if (!checks.version || errors.some((f) => f.field === 'summary'))
        throw new ORPCError('BAD_REQUEST', {
          message: "The right words can't be sent as they are. Write them in plain text.",
        })
      await proposals.discard(created.id, created.revision)
      return null
    }
    const submitted = await proposals.submit(created.id, created.revision, {
      byDomainOwners: false,
    })
    await review.checkSubmitted(submitted.id)
    return submitted.id
  }

  /**
   * The domain of each metric or dimension, as Definitions shows it: its own, or else the one its
   * source names (`termDomain`).
   */
  async function termAreas(
    terms: readonly { key: string; areaId: string | null }[],
    keys: readonly string[],
  ): Promise<(key: string) => string | undefined> {
    const hints = keys.length
      ? await tx.query<{ key: string; areaId: string | null }>(
          `select key, area_id as "areaId"
             from serving_source_domains((select seq from live_edition)) where key = any($1)`,
          [keys],
        )
      : []
    return (key) =>
      termDomain(
        terms.find((t) => t.key === key)?.areaId ?? null,
        hints.find((h) => h.key === key)?.areaId ?? null,
      ).areaId ?? undefined
  }

  /**
   * Related context, one step away, as agents follow it with read_context on what they get now:
   * from an item the person may read, or from a metric or a dimension by its key.
   */
  async function relatedOf(id: string): Promise<RelatedContext | null> {
    const item = id.startsWith('itm_')
    const row = item ? await library.getIndexRow(id) : null
    if (item && !row) return null
    const bundle = await liveServingBundle(tx, cache)
    const graph = related(bundle, { id, depth: 1, today: clock.today() })
    const termArea = await termAreas(bundle.terms, [
      ...(item ? [] : [id]),
      ...(graph.found ? graph.nodes.filter((n) => n.type !== 'item').map((n) => n.id) : []),
    ])
    const areaId = item ? row?.areaId : termArea(id)
    // An item the person may read that agents are not given has nothing to follow; a definition
    // that is not in the vocabulary agents read is not found.
    if (!graph.found) return item ? { ...(areaId ? { areaId } : {}), nodes: [], withheld: 0 } : null
    // Each node once, by the start's own link to it that comes first in the fixed order, read
    // from the start's side. Links among the neighbours are not how they relate to the start. A
    // metric the text mentions and the item applies to is a link people follow: the mention wins.
    const backwards: Record<string, string> = { mentions: 'mentioned_by', replaces: 'replaced_by' }
    const relationOf = new Map<string, string>()
    for (const e of graph.edges) {
      const [other, rel] =
        e.from === id ? [e.to, e.rel] : e.to === id ? [e.from, backwards[e.rel] ?? e.rel] : []
      if (!other || !rel) continue
      const known = relationOf.get(other)
      if (!known || (known === 'applies_to' && rel !== 'in_area')) relationOf.set(other, rel)
    }
    // A retired or replaced item gives agents only the words that linked to it (FR-333); people
    // read it by its title and domain, as the Context list shows it, when they may read it.
    const retired = new Map(
      await Promise.all(
        graph.nodes
          .filter((node) => node.type === 'item' && node.status !== 'current')
          .map(async (node) => [node.id, await library.getIndexRow(node.id)] as const),
      ),
    )
    return {
      ...(areaId ? { areaId } : {}),
      nodes: graph.nodes.map((node) => {
        const type = ['item', 'metric', 'dimension', 'dimension_value', 'area', 'term'].includes(
          node.type,
        )
          ? (node.type as RelatedContext['nodes'][number]['type'])
          : 'other'
        const shown = retired.get(node.id)
        const area = 'area' in node && node.area ? node.area : (shown?.areaId ?? termArea(node.id))
        return {
          type,
          id: node.id,
          label: shown?.title ?? node.label,
          relation: relationOf.get(node.id) ?? 'mentions',
          status: node.status,
          ...('kind' in node ? { kind: node.kind } : shown ? { kind: shown.kind } : {}),
          ...(area ? { areaId: area } : {}),
        }
      }),
      withheld: graph.withheld,
    }
  }

  /**
   * Publish in one step (FR-137): the draft becomes a suggestion, and an owner of its domain or
   * an admin publishes it at once, through the same checks and gate as the review. Anyone else's
   * waits for the owners. A publish that the gate refuses changes nothing.
   */
  async function publish(input: {
    draft: Draft
    newValues?: NewValues | undefined
    itemId?: string | undefined
    version?: number | undefined
    reason?: string | undefined
    draftId?: string | undefined
    gapId?: string | undefined
    relations?: { itemId: string; relation: ClashRelation }[] | undefined
  }): Promise<PublishItemResult> {
    if (input.gapId) await createGapsService(tx).linkable(input.gapId)
    const created = input.draftId
      ? await finish(input.draftId, input.draft, input.reason, input.newValues)
      : await proposals.create({
          draft: input.draft,
          ...(input.newValues ? { newValues: input.newValues } : {}),
          ...(input.itemId ? { itemId: input.itemId } : {}),
          ...(input.itemId && input.version !== undefined ? { version: input.version } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        })
    // Written for a Nothing written yet card: its publish covers the gap (review's publishAccepted).
    const revision = input.gapId
      ? (
          await tx.query<{ revision: number }>(
            'update proposals set source_gap_id = $2 where id = $1 returning revision',
            [created.id, input.gapId],
          )
        )[0]!.revision
      : created.revision
    // A draft that was started from an item changes that item. A new item waiting for review has
    // one already, which agents don't get yet.
    const itemId = input.draftId
      ? created.action === 'change'
        ? (created.itemId ?? undefined)
        : undefined
      : input.itemId
    const mine = await me()
    const theirs = created.proposerId !== mine.id
    const submitted = await proposals.submit(created.id, revision, { byDomainOwners: theirs })
    await review.checkSubmitted(submitted.id)
    const areaId = submitted.areaId!
    // A change to an item is the person's to publish only where they own both its domain now and
    // the one it goes to, as a move in the Context list is.
    // It fails closed: a change whose item agents don't get now waits as a suggestion.
    const owns = (area: string) => mine.admin || mine.owns.includes(area)
    let fromOwned = true
    if (itemId) {
      const [live] = await tx.query<{ areaId: string }>(
        `select v.area_id as "areaId" from item_version_service s join item_versions v on v.id = s.version_id
          where s.item_id = $1 and s.editions @> (select seq from live_edition)`,
        [itemId],
      )
      fromOwned = !!live && owns(live.areaId)
    }
    if (theirs && (!owns(areaId) || !fromOwned)) notTheirsToPublish()
    if (!owns(areaId) || !fromOwned)
      return { published: false, proposalId: submitted.id, ownerIds: await domainOwners(areaId) }
    const current = await proposals.get(submitted.id)
    const published = await path.publish(
      {
        id: current.id,
        revision: current.revision,
        ...(input.relations?.length ? { relations: input.relations } : {}),
      },
      { clashesOnly: true },
    )
    return {
      published: true,
      itemId: published.proposal.itemId!,
      proposalId: submitted.id,
      edition: published.edition?.label ?? null,
      undo: published.undo,
    }
  }

  /**
   * The person's own draft, or their suggestion an owner returned, with the words they finished it
   * with: its writer sends it. A suggestion waiting for review is edited only by an owner or an
   * admin, to publish it as itself (Edit then publish): its writer withdraws it. Someone else's
   * draft is never found: only its writer reads it (FR-139).
   */
  async function finish(
    id: string,
    draft: Draft,
    reason: string | undefined,
    newValues: NewValues | undefined,
  ) {
    const [row] = await tx.query<{
      revision: number
      proposerId: string | null
      areaId: string
      waiting: boolean
    }>(
      `select revision, proposer_id::text as "proposerId", area_id as "areaId",
              state in ('submitted','in_review') as waiting from proposals
        where id = $1 and subject = 'item' and action in ('create','change')
          and state in ('draft','changes_requested','submitted','in_review')`,
      [id],
    )
    if (!row) throw new ORPCError('NOT_FOUND', { message: "This draft isn't here any more." })
    const mine = await me()
    const to = draft.areaId ?? row.areaId
    const mayPublish = mine.admin || mine.owns.includes(to)
    if (row.waiting && row.proposerId === mine.id)
      throw new ORPCError('CONFLICT', {
        message: 'It is waiting for review. Withdraw it to change it, then send it again.',
      })
    if (row.proposerId !== mine.id && !mayPublish) notTheirsToPublish()
    return proposals.save(id, row.revision, draft, reason, {
      byDomainOwners: row.waiting,
      newValues,
    })
  }

  /**
   * Save as draft (FR-139): the person's words kept as their own draft, which only they read and
   * agents never get, to finish later. A new one, or a change to a published item written from the
   * version it names; or the words of a draft of theirs saved again. Written from a Nothing written yet card,
   * the draft is that card's, as its publish would cover the gap.
   */
  async function saveDraft(
    input: {
      draft: Draft
      newValues?: NewValues | undefined
      itemId?: string | undefined
      version?: number | undefined
      reason?: string | undefined
      draftId?: string | undefined
      revision?: number | undefined
      gapId?: string | undefined
    },
    /** Started in writing help, the editor's dock: the draft's history says so. */
    { writingHelp = false }: { writingHelp?: boolean } = {},
  ): Promise<SavedDraft> {
    if (input.gapId) await createGapsService(tx).linkable(input.gapId)
    let saved
    if (input.draftId) {
      const [row] = await tx.query(
        `select 1 from proposals
          where id = $1 and subject = 'item' and state = 'draft' and proposer_id = cl_person()`,
        [input.draftId],
      )
      if (!row) throw new ORPCError('NOT_FOUND', { message: "This draft isn't here any more." })
      // Saved over the revision the words were written from: once the person's agent changed the
      // draft since, nothing is saved, and the 409 carries the draft as it is now to merge with.
      saved = await proposals.save(input.draftId, input.revision!, input.draft, input.reason, {
        newValues: input.newValues,
      })
    } else
      saved = await proposals.create(
        {
          draft: input.draft,
          ...(input.newValues ? { newValues: input.newValues } : {}),
          ...(input.itemId ? { itemId: input.itemId } : {}),
          ...(input.itemId && input.version !== undefined ? { version: input.version } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
        writingHelp ? { via: 'writing_help' } : {},
      )
    if (!input.gapId) return { proposalId: saved.id, revision: saved.revision }
    const [linked] = await tx.query<{ revision: number }>(
      'update proposals set source_gap_id = $2 where id = $1 returning revision',
      [saved.id, input.gapId],
    )
    return { proposalId: saved.id, revision: linked!.revision }
  }

  /** Someone else's suggestion is only finished to be published: never sent on their behalf. */
  function notTheirsToPublish(): never {
    throw new ORPCError('FORBIDDEN', {
      message: notAllowed('publish this draft in that domain', 'an owner of the domain'),
    })
  }

  /**
   * A draft from pasted text, or from the page a link points to, with no model: the words, a kind
   * and dates by rule, and where it applies by the vocabulary's names (deriveAgentDraft). What it
   * guessed is named, for the writer to check. A link alone is drafted from its page, which the
   * caller read first under the workspace's rules (FR-144), or not at all: it never becomes the
   * draft's words or its source unread.
   */
  async function draftFromText(text: string, page?: PageRead): Promise<DraftFromText> {
    const today = clock.today()
    const trimmed = text.trim()
    let words = trimmed
    let title: string | undefined
    let evidence: Draft['evidence']
    if (pastedLink(trimmed)) {
      if (!page)
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: linkRefusal('off'),
          data: { reason: 'off' },
        })
      words = page.paragraphs.join('\n\n').slice(0, 4_000)
      title = page.title?.slice(0, 200) ?? undefined
      const first = page.paragraphs.find((p) => p.trim()) ?? ''
      const sentence = first.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? first
      evidence = [{ url: page.finalUrl, quote: sentence.slice(0, 500), date: today }]
    }
    if (!words)
      throw new ORPCError('UNPROCESSABLE_CONTENT', { message: 'Paste some text or a link.' })
    const derived = deriveAgentDraft(
      { text: words, ...(title ? { title } : {}) },
      { ...(await draftVocabulary(tx)), today },
    )
    // Words with no title of their own, such as a person saying what happened, are titled by their
    // first sentence, as a sent question is; the writer shortens it.
    const draft: Draft = {
      ...derived.draft,
      ...(derived.draft.title ? {} : { title: titleOfWords(derived.draft.summary ?? words) }),
      ...(evidence ? { evidence } : {}),
    }
    const unsure = Object.entries(derived.marks)
      .filter(([field, mark]) => mark !== 'confirmed' && field !== 'summary' && field !== 'body')
      .map(([field]) => field)
    return { draft, unsure: evidence ? [...unsure, 'evidence'] : unsure }
  }

  /**
   * The History log. An item the audience rule hides from the reader is left out of a change and
   * counted, never named; the change's sentence names a title, so it reads as a count instead.
   */
  async function changes(): Promise<ItemChange[]> {
    return tx.query<ItemChange>(
      `with listed as (
         select c.*,
                (select coalesce(jsonb_agg(e order by n), '[]') from jsonb_array_elements(c.items)
                   with ordinality x(e, n) where cl_item_open(e->>'id')) as shown
           from item_changes c order by c.made_at desc, c.id desc limit 200)
       select id::text, action, made_by::text as "personId",
              to_char(made_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
              case when jsonb_array_length(shown) = jsonb_array_length(items) then summary
                   else 'Changed ' || jsonb_array_length(items) || ' items.' end as summary,
              shown as items,
              (jsonb_array_length(items) - jsonb_array_length(shown))::int as withheld,
              undone_at is not null as undone
         from listed order by made_at desc, id desc`,
    )
  }

  async function deleted(): Promise<DeletedDraft[]> {
    return tx.query<DeletedDraft>(
      `select p.id::text, coalesce(nullif(p.draft->>'title', ''), 'Untitled draft') as title,
              p.area_id as "areaId", p.discarded_by::text as "personId",
              to_char(p.discarded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
         from proposals p
        where p.discarded_at is not null and p.subject = 'item'
        order by p.discarded_at desc, p.id limit 200`,
    )
  }

  return {
    page,
    markRead,
    pointAtSplitMetrics,
    bulkApply,
    undoChange,
    compare,
    restoreAsDraft,
    suggestWords,
    related: relatedOf,
    publish,
    saveDraft,
    draftFromText,
    changes,
    deleted,
  }
}

export type ContextService = ReturnType<typeof createContextService>
