/*
  The quick actions (FR-719.10): the things a person can do in the app that an answer in Ask may
  offer to open, each by one id. A read offers one: a help part by its page's `does:` front matter
  (docs/help/README.md), a definitions read by a family it found. The model marks the one its words
  explain (`[do:write_context]`), and code keeps it only when a read of the chat offered it. This
  list says, for each, where it opens and who may do it, for the service and the page alike.

  - A button only opens a screen or a dialog. Anything written is written there, with its own
    confirmation, and nothing is filled in that grants access: no address, role or key.
  - Who may is the rule the screens keep, so a button never opens a page that refuses the person;
    the service stays the authority. Anyone else is told who does it, and gets no button.
  - Where it opens comes from ids a read returned and the person's own domains, never from the
    model's words or the question.

  Pure: ids, words and addresses only.
*/

export const actionIds = [
  'write_context',
  'add_definition',
  'invite_people',
  'connect_agent',
  'connect_source',
  'publish_names',
  'pick_usual_variant',
  'family_meaning',
  'decide_conflict',
  'open_domain',
  'about_business',
  'add_domain',
] as const
export type ActionId = (typeof actionIds)[number]

export const isActionId = (id: string): id is ActionId =>
  (actionIds as readonly string[]).includes(id)

/** A family an action is about, as a read gave it: its name, its domain's noun id and its owners by name. */
export type ActionFamily = { name: string; domain: string | null; owners: string[] }

/** An action an answer offers: its id, and the family the read that offered it is about, when one is. */
export type ActionOffer = { id: ActionId; family?: ActionFamily }

/** Who reads the answer: an admin or not, and the domains they own, by id. */
export type Doer = { admin: boolean; owns: readonly string[] }

/** Where an action opens: an address in the app, with its search keys, or the Connect dialog. */
export type ActionTarget = { path: string; search?: Record<string, string> } | { dialog: 'connect' }

/**
 * Who does an action, said to someone who may not: the admins, or the owners of a domain, its
 * name's noun id and the owners by name when the read gave them, and whether an admin may too.
 */
export type DoneBy =
  | { by: 'admins' }
  | { by: 'owners'; domain: string | null; people: readonly string[]; admins: boolean }

type Action = {
  /** The screen's own verb, as the button says it. */
  label: (me: Doer) => string
  may: (me: Doer, offer: ActionOffer) => boolean
  target: (me: Doer, offer: ActionOffer) => ActionTarget
  doneBy: (offer: ActionOffer) => DoneBy
}

/** A domain's id, as the service's noun (`domain:area_sales`), its own (`area_sales`) or the mock's (`sales`). */
const domainKey = (id: string) => id.replace(/^domain:/, '').replace(/^area_/, '')
const ownsDomain = (me: Doer, domain: string | null | undefined) =>
  !!domain && me.owns.some((d) => domainKey(d) === domainKey(domain))
const owner = (me: Doer) => me.owns.length > 0
/** A person's own domain's page when they own one, else the list of domains. */
const ownDomain = (me: Doer) =>
  me.owns.length === 1 ? `/settings/domains/${me.owns[0]}` : '/settings/domains'

const anyone = () => true
const admins = (): DoneBy => ({ by: 'admins' })
/** The owners of the offer's family's domain, or an admin. */
const familyOwners = (offer: ActionOffer): DoneBy => ({
  by: 'owners',
  domain: offer.family?.domain ?? null,
  people: offer.family?.owners ?? [],
  admins: true,
})
/** A family's quick view in Definitions, where its usual variant and its meaning are chosen. */
const familyView = (_me: Doer, offer: ActionOffer): ActionTarget =>
  offer.family
    ? { path: '/definitions', search: { dock: `def.${offer.family.name}` } }
    : { path: '/definitions' }
/** An admin, or an owner of the family's domain; any owner where the read named no family. */
const mayFamily = (me: Doer, offer: ActionOffer) =>
  me.admin || (offer.family ? ownsDomain(me, offer.family.domain) : owner(me))

export const ACTIONS: Record<ActionId, Action> = {
  // Anyone writes: an item in a domain they do not own is sent to its owners as a suggestion.
  write_context: {
    label: () => 'Write context',
    may: anyone,
    target: () => ({ path: '/context/new' }),
    doneBy: admins,
  },
  add_definition: {
    label: () => 'New term',
    may: (me) => me.admin || owner(me),
    target: () => ({ path: '/definitions/new' }),
    doneBy: () => ({ by: 'owners', domain: null, people: [], admins: true }),
  },
  // An admin invites from People; an owner from their own domain's page.
  invite_people: {
    label: () => 'Invite people',
    may: (me) => me.admin || owner(me),
    target: (me) => ({ path: me.admin ? '/settings/people' : ownDomain(me) }),
    doneBy: admins,
  },
  connect_agent: {
    label: () => 'Connect an agent',
    may: anyone,
    target: () => ({ dialog: 'connect' }),
    doneBy: admins,
  },
  connect_source: {
    label: () => 'Connect a source',
    may: (me) => me.admin,
    target: () => ({ path: '/settings/integrations' }),
    doneBy: admins,
  },
  publish_names: {
    label: () => 'Publish names',
    may: (me) => me.admin || owner(me),
    target: () => ({ path: '/inbox', search: { card: 'names:waiting' } }),
    doneBy: admins,
  },
  pick_usual_variant: {
    label: () => 'Pick the usual variant',
    may: mayFamily,
    target: familyView,
    doneBy: familyOwners,
  },
  family_meaning: {
    label: () => 'Change what it means',
    may: mayFamily,
    target: familyView,
    doneBy: familyOwners,
  },
  // Anyone may compare the two; each way to decide says on the conflict who may take it.
  decide_conflict: {
    label: () => 'Open Conflicts',
    may: anyone,
    target: () => ({ path: '/context', search: { show: 'conflicts' } }),
    doneBy: admins,
  },
  // Only a domain's owners let an agent publish in it, never an admin who owns none.
  open_domain: {
    label: (me) => (me.owns.length === 1 ? 'Open your domain' : 'Open Domains and owners'),
    may: owner,
    target: (me) => ({ path: ownDomain(me) }),
    doneBy: () => ({ by: 'owners', domain: null, people: [], admins: false }),
  },
  about_business: {
    label: () => 'Write About our business',
    may: (me) => me.admin,
    target: () => ({ path: '/settings/general' }),
    doneBy: admins,
  },
  add_domain: {
    label: () => 'Add a domain',
    may: (me) => me.admin,
    target: () => ({ path: '/settings/domains/new' }),
    doneBy: admins,
  },
}

/** The most quick actions one answer carries. */
export const ACTIONS_SHOWN = 2
