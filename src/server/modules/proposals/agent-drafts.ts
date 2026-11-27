import { ORPCError } from '@orpc/client'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import type { Patch } from '../../../domain/agent-draft.ts'
import type { Draft } from '../../../domain/draft.ts'
import {
  draftFields,
  personChangedSince,
  type DraftFieldName,
  type FieldStamps,
} from '../../../domain/draft-stamps.ts'
import {
  changedFields,
  provenanceOf,
  type FieldMark,
  type MarkedField,
} from '../../../domain/provenance.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { retryWrite } from './retry.ts'
import { createProposalsService } from './service.ts'
import { productName } from '../../brand.ts'

/*
  The one write path for a draft that an AI agent wrote for the person, through the MCP tools
  `suggest_context` and `write_draft` (FR-121): it saves a draft owned by the person through
  proposals.create, with a mark on every field, and draft-tool.ts then submits it for review
  (FR-102, FR-122); write_draft never does. A change an agent makes to one of the person's drafts
  goes through proposals.save, as the person's own edit does, field by field: a field the person
  changed since the agent read the draft stays theirs.
*/

export type AgentDraftRequest = {
  draft: Draft
  itemId?: string
  /** The mark of each field as the writer filled it; a field absent from the draft loses it. */
  marks: Partial<Record<MarkedField, FieldMark>>
  /** The person was unsure of the dates, or gave none: the draft's dates are flagged. */
  datesUncertain?: boolean
  /** A resent request with the same key returns the same draft instead of a second one. */
  retryKey?: string
  /**
   * The question round whose answers the person gave in their agent (MCP elicitation). A round
   * saves one draft: a second save with it, a replayed request state, is refused.
   */
  answersRound?: string
  /** The agent that sent it (FR-420): named on the proposal. */
  agentId?: string
}

/** The drafts an agent may save for one person (`limits.agent_drafts`, FR-809). */
async function agentDraftLimits(tx: Queryable) {
  const [setting] = await tx.query<{ perDay: number; open: number }>(
    `select (value->>'per_day')::int as "perDay",(value->>'open')::int as open
       from settings_current where key='limits.agent_drafts'`,
  )
  return { perDay: setting?.perDay ?? 10, open: setting?.open ?? 20 }
}

/**
 * Refuses another agent draft when the person's agents saved their day's share in the last 24
 * hours, or when too many of their agent drafts wait unsubmitted. A discarded draft still counts
 * for the day. Counted from the proposals themselves, so no counter names the person.
 */
async function checkLimits(tx: Queryable) {
  // One agent draft of a person at a time, so two at once cannot both pass the count.
  await tx.query(
    "select pg_advisory_xact_lock(hashtextextended('agent_draft:' || cl_person()::text,0))",
  )
  const limits = await agentDraftLimits(tx)
  const [used] = await tx.query<{ today: number; open: number }>(
    `select count(*) filter (where created_at > now() - interval '24 hours')::int as today,
            count(*) filter (where state='draft' and discarded_at is null)::int as open
       from proposals where proposer_id=cl_person() and channel='mcp'`,
  )
  if ((used?.today ?? 0) >= limits.perDay)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `Your agents saved ${limits.perDay} drafts in the last 24 hours, the most allowed. Finish or discard one in ${productName}, or try again tomorrow.`,
    })
  if ((used?.open ?? 0) >= limits.open)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `${limits.open} drafts from your agents wait unsubmitted. Submit or discard some in ${productName} first.`,
    })
}

/** Saves the draft as the person, with its marks. Never submits it. */
export async function saveAgentDraft(
  tx: Queryable,
  clock: Clock,
  personId: string,
  request: AgentDraftRequest,
): Promise<ProposalRecord> {
  await checkLimits(tx)
  // Under the person's agent-draft lock taken above; the unique column backs it up.
  if (request.answersRound) {
    const [used] = await tx.query('select 1 from proposals where answers_round=$1', [
      request.answersRound,
    ])
    if (used)
      throw new ORPCError('CONFLICT', {
        message: `These answers already saved a draft. Open it in ${productName}, or call the tool again without them`,
      })
  }
  const proposals = createProposalsService(tx, clock, personId)
  const input = {
    draft: request.draft,
    ...(request.itemId ? { itemId: request.itemId } : {}),
    channel: 'mcp' as const,
  }
  const create = () =>
    proposals.create(input, {
      provenance: (draft) => provenanceOf('agent', request.marks, draft, request.datesUncertain),
      ...(request.answersRound ? { answersRound: request.answersRound } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
    })
  return request.retryKey
    ? retryWrite(tx, request.retryKey, 'mcp.suggest_context', input, create)
    : create()
}

/** How many times the person's agents may change one draft in an hour: a loop stops here. */
export const AGENT_WRITES_PER_HOUR = 60

export type AgentPatchRequest = {
  id: string
  /** The revision the agent read the draft at (read_draft, or its last write_draft). */
  revision: number
  /** The fields it changes, by the names agents use, worked out as a draft's are. */
  names: readonly DraftFieldName[]
  patch: Patch
  /** The person was unsure of the new dates. */
  datesUncertain?: boolean
  /** The agent that changed it (FR-420): named in the history of this change. */
  agentId?: string
}
export type AgentPatchResult = {
  /** The draft after the change, or as it is when nothing changed. */
  proposal: ProposalRecord
  stamps: FieldStamps
  applied: DraftFieldName[]
  /** The fields the person changed since the agent's revision, left as they are. */
  conflicts: DraftFieldName[]
}

/**
 * Changes the fields an agent gives in one of the person's own drafts, as the person, and never
 * sends it. A draft that is not theirs reads as not found; one that was sent is refused. Each
 * field the person changed after the agent's revision keeps the person's words, and the rest
 * apply, through the same save, checks and history as the person's own edit.
 */
export async function patchAgentDraft(
  tx: Queryable,
  clock: Clock,
  personId: string,
  request: AgentPatchRequest,
): Promise<AgentPatchResult> {
  const proposals = createProposalsService(tx, clock, personId)
  const notFound = () =>
    new ORPCError('NOT_FOUND', { message: 'No draft of yours has that draft_id' })
  // Row security lets an owner read a suggestion sent to them: only the writer's own is a draft here.
  const p = await proposals.get(request.id, true).catch(() => {
    throw notFound()
  })
  if (p.proposerId !== personId || p.subject !== 'item' || !['create', 'change'].includes(p.action))
    throw notFound()
  if (p.state !== 'draft')
    throw new ORPCError('CONFLICT', {
      message: ['submitted', 'in_review', 'changes_requested'].includes(p.state)
        ? 'It was sent. Withdraw it to change it'
        : 'It is no draft any more: it was published, closed or withdrawn. Write a new draft instead',
      data: { state: p.state },
    })
  if (request.revision > p.revision)
    throw new ORPCError('CONFLICT', {
      message: `The draft is at revision ${p.revision}, before the revision given. Read it again`,
    })
  const [writes] = await tx.query<{ n: number }>(
    `select count(*)::int as n from proposal_events
      where proposal_id=$1 and kind='updated' and at > now() - interval '1 hour'`,
    [p.id],
  )
  if ((writes?.n ?? 0) >= AGENT_WRITES_PER_HOUR)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `Your agents changed this draft ${AGENT_WRITES_PER_HOUR} times in the last hour, the most allowed. Try again later, or finish it in ${productName}`,
    })
  const stamps = await proposals.stampsOf(p.id)
  const conflicts = personChangedSince(stamps, request.names, request.revision)
  const applied = request.names.filter((name) => !conflicts.includes(name))
  const next: Draft = { ...p.draft }
  for (const name of applied) {
    const field = draftFields[name]
    Object.assign(next, { [field]: request.patch.draft[field] })
    // An agent's words carry no mentions: its summary or text replaces the person's markup.
    if (field === 'summary') delete next.summaryMarkup
    if (field === 'body') delete next.bodyMarkup
  }
  if (!changedFields(p.draft, next).length) return { proposal: p, stamps, applied: [], conflicts }
  const saved = await proposals.save(p.id, p.revision, next, undefined, {
    agent: {
      marks: request.patch.marks,
      ...(request.datesUncertain ? { datesUncertain: true } : {}),
      ...(request.agentId ? { id: request.agentId } : {}),
    },
  })
  return { proposal: saved, stamps: await proposals.stampsOf(p.id), applied, conflicts }
}
