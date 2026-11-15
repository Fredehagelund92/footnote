import { createHash, randomBytes } from 'node:crypto'
import { ORPCError } from '@orpc/client'
import {
  INVITE_DAYS,
  inviteLinkOf,
  type CreateInvitesInput,
  type Invite,
  type InviteLookup,
  type InviteResent,
  type InvitesCreated,
} from '../../../contract/members.ts'
import type { Queryable } from '../../db/database.ts'
import { lockRoles } from './roles.ts'

/*
  Invites (FR-417): an address asked to join as an Admin or a Member, owning some domains from
  the start. Its link carries 256 random bits; the database keeps only their SHA-256, so neither
  a copy of the database nor its logs hold a working link. The link is shown once, to whoever
  invites or sends the invite again, and a new one replaces the old. An invite is accepted once,
  at the first sign-in that proves its address, within a week of when it was last sent, while its
  standing (invite_standing, in the database) is open: the list, the link page and the sign-in all
  read that one rule.
*/

/** A new invite link's token: 256 random bits, as 43 URL-safe characters. */
const newToken = () => randomBytes(32).toString('base64url')
export const inviteTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Where an invite's link leads: the sign-in screen of the web app, which names the invite. */
export const inviteLink = inviteLinkOf

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const inviteColumns = `i.id::text, i.email, i.role, i.area_ids as "areaIds", i.invited_by::text as "invitedBy",
  ${iso('i.sent_at')} as "sentAt", ${iso('i.expires_at')} as "expiresAt",
  s.standing, s.why as "voidBecause", s.area_ids as "willOwn"`
const invitesWithStanding = 'invites i cross join lateral invite_standing(i) s'
const open = 'i.accepted_at is null and i.revoked_at is null'
const resendRefused =
  'Only an admin, or the sender while they still own the domains, sends an invite again.'
/** Why an invite is not sent again whoever asks: a new link would let nobody in either. */
const resendPointless: Partial<Record<NonNullable<Invite['voidBecause']>, string>> = {
  member: 'They are a member already. Take this invite back instead.',
  erased: "This person can't join again. Take this invite back instead.",
}
const gone = () =>
  new ORPCError('NOT_FOUND', {
    message: "We couldn't find this invite. It may have been accepted or taken back.",
  })

/** The open invites, newest first. */
export async function listInvites(tx: Queryable): Promise<Invite[]> {
  return tx.query<Invite>(
    `select ${inviteColumns} from ${invitesWithStanding} where ${open} order by i.sent_at desc, i.id`,
  )
}

async function inviteOf(tx: Queryable, id: string): Promise<Invite> {
  const [invite] = await tx.query<Invite>(
    `select ${inviteColumns} from ${invitesWithStanding} where i.id=$1`,
    [id],
  )
  return invite!
}

/**
 * Invites each address once: one already in the workspace or with an open invite is named, not
 * invited again. An admin invites anyone as anything; an owner who is not an admin invites a
 * Member to domains they own (row security checks it again). An expired or void invite that its
 * sender or an admin could send again is taken back and replaced.
 */
export async function createInvites(
  tx: Queryable,
  input: CreateInvitesInput,
  webOrigin: string,
): Promise<InvitesCreated> {
  const areaIds = [...new Set(input.areaIds)]
  const [actor] = await tx.query<{ id: string | null; admin: boolean; owns: boolean }>(
    'select cl_person()::text as id, cl_is_admin_now() as admin, cl_owns_all($1::text[]) as owns',
    [areaIds],
  )
  if (!actor?.id) throw new ORPCError('UNAUTHORIZED')
  if (!actor.admin && (input.role !== 'member' || !areaIds.length || !actor.owns))
    throw new ORPCError('FORBIDDEN', {
      message:
        'Only an admin invites people. An owner invites people to their own domains, but not as an admin.',
    })
  const live = areaIds.length
    ? await tx.query<{ id: string }>(
        'select id from areas where id = any($1::text[]) and archived_at is null',
        [areaIds],
      )
    : []
  if (live.length !== areaIds.length)
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this domain, or it was deleted.",
    })
  // Serialized with every role change and with accepting an invite.
  await lockRoles(tx)
  const results: InvitesCreated['results'] = []
  for (const email of [...new Set(input.emails.map((e) => e.trim().toLowerCase()))]) {
    const [member] = await tx.query<{ id: string }>(
      'select id::text from people where email=$1 and deactivated_at is null and erased_at is null',
      [email],
    )
    if (member) {
      results.push({ email, outcome: 'member', personId: member.id })
      continue
    }
    if (!actor.admin) {
      const [gone] = await tx.query(
        'select 1 from people where email=$1 and deactivated_at is not null and erased_at is null',
        [email],
      )
      if (gone) {
        results.push({ email, outcome: 'removed' })
        continue
      }
    }
    const [pending] = await tx.query<Invite>(
      `select ${inviteColumns} from ${invitesWithStanding} where i.email=$1 and ${open}`,
      [email],
    )
    if (pending) {
      if (pending.standing === 'open' || !(actor.admin || pending.invitedBy === actor.id)) {
        results.push({ email, outcome: 'pending', invite: pending })
        continue
      }
      await tx.query('update invites set revoked_at=now(), revoked_by=cl_person() where id=$1', [
        pending.id,
      ])
      await record(tx, 'invite.revoked', pending)
    }
    const token = newToken()
    const [made] = await tx.query<{ id: string }>(
      `insert into invites (email,role,area_ids,invited_by,token_hash,expires_at)
       values ($1,$2,$3::text[],cl_person(),$4,now() + make_interval(days => $5))
       returning id::text`,
      [email, input.role, areaIds, inviteTokenHash(token), INVITE_DAYS],
    )
    const invite = await inviteOf(tx, made!.id)
    await record(tx, 'invite.created', invite)
    results.push({ email, outcome: 'invited', invite, link: inviteLink(webOrigin, token) })
  }
  return { results }
}

/**
 * Sends an invite again, by an admin or by its sender while they could still make it (a Member
 * invite to domains they still own): a new link for another week; the old one stops. An admin who
 * sends again an invite its sender can no longer make becomes its sender, so the new link works.
 * One to a member already, or to someone erased, is not sent again: it would let nobody in. */
export async function resendInvite(
  tx: Queryable,
  id: string,
  webOrigin: string,
): Promise<InviteResent> {
  await visibleOpen(tx, id)
  const { voidBecause } = await inviteOf(tx, id)
  const pointless = voidBecause && resendPointless[voidBecause]
  if (pointless) throw new ORPCError('CONFLICT', { message: pointless })
  const [allowed] = await tx.query(
    `select 1 from invites i
      where i.id=$1 and (cl_is_admin_now()
            or (i.role='member' and cardinality(i.area_ids) > 0 and cl_owns_all(i.area_ids)))`,
    [id],
  )
  if (!allowed) throw new ORPCError('FORBIDDEN', { message: resendRefused })
  const token = newToken()
  const [sent] = await tx.query<{ id: string }>(
    `update invites i set token_hash=$2, sent_at=now(), expires_at=now() + make_interval(days => $3),
            invited_by = case when cl_is_admin_now() and (invite_standing(i)).why = 'sender'
                              then cl_person() else i.invited_by end
      where i.id=$1 and ${open} returning i.id::text`,
    [id, inviteTokenHash(token), INVITE_DAYS],
  )
  if (!sent) throw new ORPCError('FORBIDDEN', { message: resendRefused })
  const invite = await inviteOf(tx, sent.id)
  await record(tx, 'invite.resent', invite)
  return { invite, link: inviteLink(webOrigin, token) }
}

/** Takes an invite back, by its sender or an admin: its link stops working. */
export async function revokeInvite(tx: Queryable, id: string): Promise<{ revoked: boolean }> {
  await visibleOpen(tx, id)
  const [invite] = await tx.query<Pick<Invite, 'id' | 'role' | 'areaIds'>>(
    `update invites i set revoked_at=now(), revoked_by=cl_person()
      where i.id=$1 and ${open} returning i.id::text, i.role, i.area_ids as "areaIds"`,
    [id],
  )
  if (!invite)
    throw new ORPCError('FORBIDDEN', {
      message: 'Only whoever sent an invite, or an admin, takes it back.',
    })
  await record(tx, 'invite.revoked', invite)
  return { revoked: true }
}

/**
 * Accepts the open invite of an address a sign-in has just proven, once (auth.accept_invite):
 * the person, made or brought back, with the invite's role and the domains its standing gives; null
 * when the address has no invite whose standing is open. Nobody is signed in yet, so it runs as the
 * database owner.
 */
export async function acceptInvite(
  tx: Queryable,
  identity: { email: string; name: string },
): Promise<string | null> {
  const [row] = await tx.query<{ person: string | null }>(
    'select auth.accept_invite($1,$2)::text as person',
    [identity.email, identity.name],
  )
  return row?.person ?? null
}

async function visibleOpen(tx: Queryable, id: string) {
  const [row] = await tx.query(`select 1 from invites i where i.id=$1 and ${open}`, [id])
  if (!row) throw gone()
}

/** The history entry of a change to an invite: what and who for, never the address. */
async function record(
  tx: Queryable,
  action: string,
  invite: Pick<Invite, 'id' | 'role' | 'areaIds'>,
) {
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,subject_type,subject_id,details,source)
     values(cl_person(),'person',$1,'invite',$2,$3::jsonb,'named')`,
    [action, invite.id, JSON.stringify({ role: invite.role, areas: invite.areaIds })],
  )
}

/**
 * What an invite link says on the sign-in screen, by its token: the address, the role and the
 * domains it gives, while its standing is open. Every other token, whatever the reason (never sent,
 * sent again since, taken back, used, too old, void), gets the same answer.
 */
export async function lookupInvite(tx: Queryable, token: string): Promise<InviteLookup> {
  const [row] = await tx.query<{
    email: string
    role: InviteLookup['role']
    areas: InviteLookup['areas']
    expiresAt: string
  }>(
    `select email, role, areas, ${iso('expires_at')} as "expiresAt" from auth.invite_by_token($1)`,
    [inviteTokenHash(token)],
  )
  if (!row)
    throw new ORPCError('NOT_FOUND', {
      message: "This invite link doesn't work any more. Ask whoever invited you for a new one.",
    })
  return row
}
