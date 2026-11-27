import type { Permissions } from '@contract/auth'
import { opensOnlyHere } from '@/lib/local-address'
import type { DomainId, Fact } from './items'

// The workspace's people and domains as the app reads them (src/web/api): two roles, an admin or
// a member, and ownership per domain, which lives on the domain; and the open invites, which are
// nobody here yet. Pure types and the rules that follow from them.

/** A member of the workspace. */
export type Person = {
  /** The service's id for them: every write names them by it, never by their name. */
  id: string
  name: string
  /** One line on what they do here, derived from what they own and whether they are an admin. */
  role: string
  owns: DomainId[]
  admin: boolean
  /** Their work address; derived from the name when not given. */
  email?: string
  /** When they last used Footnote, in words. */
  lastActive?: string
}

/**
 * An open invite: someone asked in by address, who has not signed in yet. Its role and domains
 * stay as sent: a new link or taking it back are all that change it.
 */
export type Invite = {
  /** The service's id for the invite. */
  id: string
  email: string
  admin: boolean
  /** The domains they own once they sign in, by the rule the sign-in uses. */
  willOwn: DomainId[]
  /** The domains it was sent to, by id, as the sender made it: a sender sends it again only while they own all of them. */
  sentTo: DomainId[]
  /** Who sent it, by id; null for one made at the command line, which has no sender. */
  sentBy: string | null
  /** Whether it lets them in: open, expired (a new link gives another week), or void. */
  standing: 'open' | 'expired' | 'void'
  /**
   * Why a void invite lets nobody in: its sender can no longer make it (an admin's new link makes
   * the admin its sender), they are a member already, or the person was erased.
   */
  voidBecause: 'sender' | 'member' | 'erased' | null
}

/** Someone on the People page: a member, or an invite. */
export type Party = ({ kind: 'member' } & Person) | ({ kind: 'invite' } & Invite)

/** A domain: its name, who owns it, and its text in its own words (what it covers, then its house rules). */
export type Domain = {
  id: DomainId
  name: string
  /** Its owners by name: members only, never an invite (an invite's domains are its own). */
  owners: string[]
  /** The first paragraph of the text, plain: what the domain covers. */
  covers: string
  /** The whole text, light markdown with mentions. */
  text: string
  /** The sandbox, where people try context: agents never get it, and it is never deleted. */
  sandbox?: boolean
}

/** The domains by id, in the order the workspace lists them. */
export type Domains = Record<DomainId, Domain>

/** Who answers for an item: its own owners, or else its domain's. */
export const ownersOf = (f: Pick<Fact, 'owners' | 'domain'>, domains: Domains) =>
  f.owners?.length ? f.owners : (domains[f.domain]?.owners ?? [])

/**
 * Where new context a person writes starts: a domain they own (the sandbox last), else the
 * workspace's first. Undefined only in a workspace with no domains at all.
 */
export function homeDomain(p: Pick<Person, 'owns'>, domains: Domain[]): Domain | undefined {
  const owned = domains.filter((d) => p.owns.includes(d.id))
  return owned.find((d) => !d.sandbox) ?? owned[0] ?? domains.find((d) => !d.sandbox) ?? domains[0]
}

/** "Jon Abara", "Jon Abara and Sofia Brandt", "Ravi Kapoor, Ella Voss or Lars Dahl". */
export const listOf = (names: string[], last = 'and') =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1)}` : (names[0] ?? '')

/** What a person holds in the server's words: administrator, and owner of each domain they own. */
export const toServerPermissions = (p: Person): Permissions => ({
  roles: p.admin ? ['administrator'] : [],
  assignments: p.owns.map((areaId) => ({ areaId, role: 'owner' })),
})

export const emailOf = (p: Person) =>
  p.email ?? `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@larchwood.example`

/** The line for someone who is no admin and owns no domain: true of most people, so it tells none apart. */
export const PLAIN_ROLE = 'Suggests context, owns no domain'

/** One line on what a person does here: what they own (the sandbox aside) and whether they are an admin. */
export function describe(p: Person, domains: Domains) {
  const owned = p.owns.filter((d) => domains[d] && !domains[d].sandbox).map((d) => domains[d]?.name)
  if (owned.length) return `Owner of ${listOf(owned as string[])}${p.admin ? ', admin' : ''}`
  return p.admin ? 'Admin' : PLAIN_ROLE
}

/**
 * The domains only this member owns: they must hand those over before they can leave. An invite
 * to a domain is nobody here yet, so it never stands in for them.
 */
export const soleOwnerOf = (name: string, domains: Domains) =>
  Object.values(domains)
    .filter((d) => d.owners.length === 1 && d.owners[0] === name)
    .map((d) => d.id)

/** Whether someone may use a control: they can, or it is kept visible, locked, with why. */
export type Allowed = 'can' | { locked: string }

/**
 * What the signed-in person may do to someone on the People page, as the service rules it
 * (src/server/modules/auth/members.ts, invites.ts). `absent` is a control the party never has.
 */
export type PartyActions = {
  /** Admin or Member: an invite keeps the role it was sent with. */
  role: Allowed | 'absent'
  /** Owner of each domain, by id: an invite keeps the domains it was sent with. */
  owners: Record<DomainId, Allowed> | 'absent'
  /** A new link for an invite. */
  resend: Allowed | 'absent'
  /**
   * Removing a member, or taking an invite back. A member who is the only owner of a domain hands
   * it over first; an invite never waits on that.
   */
  leave: Allowed | { handOver: DomainId[] }
}

export function partyActions(party: Party, me: Person, domains: Domains): PartyActions {
  if (party.kind === 'invite') {
    const sender = party.sentBy !== null && party.sentBy === me.id
    return {
      role: 'absent',
      owners: 'absent',
      // Its sender sends it again while they still own its domains; an admin, one its sender can
      // no longer make, and becomes its sender. A new link to a member would let nobody in.
      resend:
        party.voidBecause === 'member' || party.voidBecause === 'erased'
          ? { locked: 'A new link would not let them in. Take the invite back' }
          : me.admin ||
              (sender &&
                party.voidBecause !== 'sender' &&
                party.sentTo.every((d) => me.owns.includes(d)))
            ? 'can'
            : party.voidBecause === 'sender'
              ? { locked: 'Its sender can no longer make this invite. An admin makes a new link' }
              : { locked: 'Only an admin or whoever sent it makes a new link' },
      leave:
        me.admin || sender ? 'can' : { locked: 'Only an admin or whoever sent it takes it back' },
    }
  }
  const self = party.id === me.id
  const alone = soleOwnerOf(party.name, domains)
  return {
    role: !me.admin
      ? { locked: 'Only an admin changes roles' }
      : self
        ? { locked: "You can't change your own role" }
        : 'can',
    owners: Object.fromEntries(
      Object.keys(domains).map((d): [DomainId, Allowed] => [
        d,
        me.admin || me.owns.includes(d)
          ? 'can'
          : { locked: 'Only its owners and admins add owners' },
      ]),
    ),
    resend: 'absent',
    leave: !me.admin
      ? { locked: 'Only an admin removes people' }
      : self
        ? { locked: "You can't remove yourself" }
        : alone.length
          ? { handOver: alone }
          : 'can',
  }
}

/** The first paragraph of a domain's text, plain: what it covers, for pickers, hints and cards. */
export function excerptOf(text: string) {
  const first = text.split('\n\n')[0] ?? ''
  // Plain words: a mention reads as its label, and markdown marks drop away.
  return first
    .replace(/\[@ id="[^"]*" label="([^"]*)"\]/g, '$1')
    .replace(/\*\*|`|^[-#>] /gm, '')
    .trim()
}

/**
 * What an invite's link does, as the toast says once it is made. Where people pick who they are
 * from a list (`picker`), nobody invited is on it, so the link lets them in only once company
 * sign-in is set up; and a link to this computer itself opens nowhere else.
 */
export function inviteLinkWords(links: readonly { link: string }[], picker: boolean): string {
  const one = links.length === 1
  if (picker)
    return one
      ? 'The link lets them in once company sign-in is set up. It works for 7 days.'
      : 'Each link lets its person in once company sign-in is set up. They work for 7 days.'
  if (links.some((l) => opensOnlyHere(l.link)))
    return one
      ? 'The link opens only on this computer. It works for 7 days.'
      : 'The links open only on this computer. They work for 7 days.'
  return one
    ? 'Send them the link to sign in. It works for 7 days.'
    : 'Send each their link to sign in. It works for 7 days.'
}
