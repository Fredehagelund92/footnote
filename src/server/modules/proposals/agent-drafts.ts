import { ORPCError } from '@orpc/client'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import { agentDraftsDefault, type Patch } from '../../../domain/agent-draft.ts'
import { textFindings, type Draft, type FormatFinding } from '../../../domain/draft.ts'
import {
  draftFields,
  personChangedSince,
  type DraftFieldName,
} from '../../../domain/draft-stamps.ts'
import {
  changedFields,
  provenanceFlags,
  provenanceOf,
  type FieldMark,
  type MarkedField,
  type ProvenanceFlag,
} from '../../../domain/provenance.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { createProposalsService } from './service.ts'
import { productName } from '../../brand.ts'

/*
  The one write path for a draft that an AI agent wrote for the person, through the MCP tool
  `write_draft` (FR-121): it saves a draft owned by the person through proposals.create, with a
  mark on every field, and never sends it; `send_draft` submits it for review after the person
  says yes (FR-102, FR-122). A change an agent makes to one of the person's drafts goes through
  proposals.save, as the person's own edit does, field by field: a field the person changed since
  the agent read the draft stays theirs. Writing help, the editor's dock, changes a draft through
  the same path, as its own writer (Route 3).
*/

/**
 * Why a writer's words are never stored, by the checks every write passes, a first one or a change
 * (FR-117, NFR-024): text that looks like personal data or a secret, or words that read like
 * orders to an AI agent. Null when they may be stored.
 */
export function refusedWords(
  draft: Draft,
):
  | { kind: 'sensitive'; findings: FormatFinding[] }
  | { kind: 'orders'; flags: ProvenanceFlag[] }
  | null {
  const findings = textFindings(draft)
  if (findings.length) return { kind: 'sensitive', findings }
  const flags = provenanceFlags(draft).filter((flag) => flag.code === 'instruction_like_text')
  return flags.length ? { kind: 'orders', flags } : null
}

export type AgentDraftRequest = {
  draft: Draft
  itemId?: string
  /** The mark of each field as the writer filled it; a field absent from the draft loses it. */
  marks: Partial<Record<MarkedField, FieldMark>>
  /** The person was unsure of the dates, or gave none: the draft's dates are flagged. */
  datesUncertain?: boolean
  /** The agent that sent it (FR-420): named on the proposal. */
  agentId?: string
}

/** The drafts an agent may save for one person (`limits.agent_drafts`, FR-809). */
async function agentDraftLimits(tx: Queryable) {
  const [setting] = await tx.query<{ perDay: number | null; open: number | null }>(
    `select (value->>'per_day')::int as "perDay",(value->>'open')::int as open
       from settings_current where key='limits.agent_drafts'`,
  )
  return {
    perDay: setting?.perDay ?? agentDraftsDefault.perDay,
    open: setting?.open ?? agentDraftsDefault.open,
  }
}

/** The person's agent drafts against the cap, after a new one is saved: the agent tells the person. */
export type AgentDraftCount = {
  /** Their agents' drafts not sent or discarded yet, the new one too. */
  waiting: number
  mostWaiting: number
  /** New drafts their agents saved in the last 24 hours, discarded ones too. */
  newIn24Hours: number
  mostNewIn24Hours: number
}

/** The cap in words, as the tool text says it. */
const capWords = (limits: { perDay: number; open: number }) =>
  `${limits.perDay} new drafts in 24 hours and ${limits.open} waiting unsent`

/**
 * Refuses another agent draft when the person's agents saved their day's share in the last 24
 * hours, or when too many of their agent drafts wait unsubmitted. A discarded draft still counts
 * for the day. Counted from the proposals themselves, so no counter names the person.
 */
async function checkLimits(tx: Queryable): Promise<AgentDraftCount> {
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
  const today = used?.today ?? 0
  const open = used?.open ?? 0
  if (today >= limits.perDay)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `The person's agents saved ${today} new drafts in the last 24 hours, and the most allowed is ${capWords(limits)}. Tell the person their drafts wait in Your drafts, in ${productName}'s Inbox, and save the rest tomorrow`,
    })
  if (open >= limits.open)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `${open} drafts from the person's agents wait unsubmitted, and the most allowed is ${capWords(limits)}. Ask the person to publish, send or delete some in Your drafts, in ${productName}'s Inbox, before you save more`,
    })
  return {
    waiting: open + 1,
    mostWaiting: limits.open,
    newIn24Hours: today + 1,
    mostNewIn24Hours: limits.perDay,
  }
}

/** Saves the draft as the person, with its marks. Never submits it. */
export async function saveAgentDraft(
  tx: Queryable,
  clock: Clock,
  personId: string,
  request: AgentDraftRequest,
): Promise<{ proposal: ProposalRecord; count: AgentDraftCount }> {
  const count = await checkLimits(tx)
  const proposals = createProposalsService(tx, clock, personId)
  const proposal = await proposals.create(
    {
      draft: request.draft,
      ...(request.itemId ? { itemId: request.itemId } : {}),
      channel: 'mcp' as const,
    },
    {
      provenance: (draft) => provenanceOf('agent', request.marks, draft, request.datesUncertain),
      ...(request.agentId ? { agentId: request.agentId } : {}),
    },
  )
  return { proposal, count }
}

/** How many times the person's agents may change one draft in an hour: a loop stops here. */
export const AGENT_WRITES_PER_HOUR = 60

export type AgentPatchRequest = {
  id: string
  /** The revision the writer read the draft at (read_draft, or its last write_draft). */
  revision: number
  /** The fields it changes, by the names agents use, worked out as a draft's are. */
  names: readonly DraftFieldName[]
  patch: Patch
  /** The person was unsure of the new dates. */
  datesUncertain?: boolean
  /** The agent that changed it (FR-420): named in the history of this change. */
  agentId?: string
  /**
   * Writing help changed it, not the person's agent. Its turns are counted before they start
   * (`cl_writing_help_turn_take`), so the agents' hourly limit on one draft is not its own.
   */
  writingHelp?: true
}
export type AgentPatchResult = {
  /** The draft after the change, or as it is when nothing changed. */
  proposal: ProposalRecord
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
  if (!request.writingHelp) {
    const [writes] = await tx.query<{ n: number }>(
      `select count(*)::int as n from proposal_events
        where proposal_id=$1 and kind='updated' and not (data ? 'writer')
          and at > now() - interval '1 hour'`,
      [p.id],
    )
    if ((writes?.n ?? 0) >= AGENT_WRITES_PER_HOUR)
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: `Your agents changed this draft ${AGENT_WRITES_PER_HOUR} times in the last hour, the most allowed. Try again later, or finish it in ${productName}`,
      })
  }
  const conflicts = personChangedSince(p.fieldStamps, request.names, request.revision)
  const applied = request.names.filter((name) => !conflicts.includes(name))
  const next: Draft = { ...p.draft }
  for (const name of applied) {
    const field = draftFields[name]
    Object.assign(next, { [field]: request.patch.draft[field] })
    // A writer's words carry no mentions: its summary or text replaces the person's markup.
    if (field === 'summary') delete next.summaryMarkup
    if (field === 'body') delete next.bodyMarkup
  }
  if (!changedFields(p.draft, next).length) return { proposal: p, applied: [], conflicts }
  const saved = await proposals.save(p.id, p.revision, next, undefined, {
    writer: {
      by: request.writingHelp ? 'writing_help' : 'agent',
      marks: request.patch.marks,
      ...(request.datesUncertain ? { datesUncertain: true } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
    },
  })
  return { proposal: saved, applied, conflicts }
}
