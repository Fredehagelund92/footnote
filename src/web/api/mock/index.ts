import { footnoteApiMethods, readMethods } from '../client'
import { clockTime, parseDay } from '@/lib/dates'
import { keepLabel, splitCardLine, splitDue } from '@domain/family-split'
import { termWord } from '@domain/terms'
import type { FootnoteApi, FootnoteApiMethod, Inbox, ObsPageInput, Undoable } from '../client'
import { agentNameProblem } from '@domain/agents'
import { ApiError } from '../errors'
import { missing } from '@contract/refusals'
import { reviewActions, type ReviewAction } from '@domain/review-actions'
import type { SavedView } from '@/lib/obs-views'
import { mentionNotesOf, type Subject } from '@/model/comments'
import { servedToAgents } from '@/model/items'
import { draftItem } from '@/model/review-page'
import { today } from '@/lib/today'
import { createComments } from './comments'
import { createAlerts } from './data/alerts'
import { historyOf, historyOfDefinition, versionPairOf } from './data/history'
import { familyMeaningHistoryOf } from '../http-family-meaning'
import { connectorById } from '@/model/catalogue'
import { DEMO_DEFINITIONS, demoTool, demoTools } from './data/integrations'
import { linksOf } from '@/lib/links'
import { cards, waiting, week } from './data/inbox'
import { norwayDraft } from './data/drafts'
import { obsData } from './data/observability'
import { obsPage } from './obs-page'
import { BEFORE, changedSteps, replay } from './replay'
import { reviews } from './data/review'
import type { InboxCard } from '@/model/inbox'
import type { Relation, Review } from '@/model/review'
import { plainOf } from '@/components/templates/comment-box/utils'
import {
  ABOUT_BUSINESS,
  dimensions,
  facts as seedFacts,
  markets,
  metrics,
  signInPeople,
  WORKSPACE_NAME,
} from './data/world'
import { examples, readDefinitionsFrom, readQuestion } from './data/ask'
import {
  advancedOf,
  contextFile,
  demoAccessKey,
  historyFile,
  UNDO_SECONDS,
  type Automatic,
  type Pins,
} from './advanced'
import { loopExample, playAnswer, recordedAnswer } from './ask-live'
import { createChats } from './chats'
import { askedThisWeek } from './data/asked-week'
import { createMockNames } from './names'
import { createSettings } from './settings'
import { createPolicies } from './policies'
import {
  checkConnect,
  connectFormFor,
  createIntegrations,
  leftOutOf,
  MOCK_TEST_MS,
  testFor,
  type Kept,
} from './integrations'
import { figureFor, figureTryFor } from './data/figures'
import { reportedOn, type Answer, type AskInput } from '@/model/ask'
import { failedAnswer } from '@/api/http-ask'
import { createDefinitions } from './definitions'
import { relationsFor } from './data/relations'
import { dimensionsOf, valuesOf } from './obs-filters'
import { publishEffects, touchedBy } from './publish'
import { SAVED_TREND } from './data/saved-questions'
import { createSaved } from './saved'
import { createScenario, type Address } from './scenario'
import { searchWorld } from './search'
import { createScopeSearch, withScope } from './scope'
import { factsOf, reduce, start, type Action, type State } from './store'
import { familyFacts } from './data/variants'
import { importedDrafts } from './data/imported'
import { createWorkspace } from './workspace'
import {
  conflictOf,
  pairsOf,
  rightsOf,
  rowOf,
  stampOf,
  stillKept,
  type KeptPair,
} from './conflicts'
import type { Fact } from '@/model/items'
import { maySettle } from '@domain/conflicts'
import { TODAY } from '@/model/history'

/**
 * The mock binding: `FootnoteApi` over the demo world, in memory. Every answer is a copy, as if it came
 * over the wire, so a cache that holds it never shares an object the mock changes later. A reload
 * starts the demo again.
 *
 * `controls` are the mock's own, for the app's review flags and the Slow network switch: the http
 * binding has none.
 */
export function createMockApi() {
  const scenario = createScenario()
  const workspace = createWorkspace()
  const comments = createComments()
  const definitions = createDefinitions()
  /** The dimensions an admin pinned on Overview in this visit (observability.pinned_dimensions). */
  let pins: Pins = { keys: [] }
  let automatic: Automatic = { on: false, version: 1 }
  /** An Observability page as the person signed in may read it, for a view. */
  const obsPageFor = ({ range, domain, agent }: Omit<ObsPageInput, 'section'>) => {
    const person = workspace.people().find((p) => p.name === me())
    const reader = { admin: !!person?.admin, owns: person?.owns ?? [] }
    const view = { range, ...(domain ? { domain } : {}), ...(agent ? { agent } : {}) }
    return obsPage(obsData(scenario.obsState()), view, reader)
  }
  const saved = createSaved()
  const alerts = createAlerts()
  const chats = createChats()
  const scope = createScopeSearch()
  const settings = createSettings()
  const names = createMockNames()
  const policies = createPolicies()
  /** What the connect flow set for each tool this visit. */
  const kept = new Map<string, Kept>()
  const integrations = createIntegrations(
    () => settings.read(scenario.address()).connected,
    (id) => kept.get(id),
  )
  let views: SavedView[] = []
  readDefinitionsFrom(definitions.list)
  let state: State = start
  const me = () => state.user ?? 'Jon Abara'
  /** What a definitions tool would stop reading with these views: its views read now, left out. */
  const leftOutNow = (id: string, input: { readsAll: boolean; views: readonly string[] }) => {
    const set = kept.get(id)
    const all =
      demoTools[id]?.scopes ?? testFor(id, { config: set?.config ?? {}, secrets: {} }).scopes
    const reading =
      set && !set.readsAll ? all.filter((s) => set.chosen.some((c) => c.id === s.id)) : all
    return leftOutOf(reading, input, { metrics, facts: factsOf(state) })
  }
  const dispatch = (action: Action) => {
    state = reduce(state, action)
  }

  /** Conflicts kept as both, by pair: off the lists while both items are as the decision saw them. */
  const keptPairs = new Map<string, KeptPair>()
  /** The person signed in, as the rules read them. */
  const meAsPerson = () => workspace.person(me())!
  /** The live pair two ids name, holder first, in either order. */
  const pairAt = (a: string, b: string) =>
    pairsOf(factsOf(state)).find(
      ([h, o]) => (h.id === a && o.id === b) || (h.id === b && o.id === a),
    )

  /**
   * What Undo needs, by token: the state before and what the write touched, who made it, and until
   * when. As the service: only its maker undoes it, once, in the demo's window, or until the page
   * goes when the service would take it at any time (`lasting`). The window reads the browser's
   * clock, which a journey can move.
   */
  const undos = new Map<string, { run: () => void; by: string | null; until: number | null }>()
  let undoCount = 0
  const remember = (undo: () => void, lasting = false): Undoable => {
    const token = `undo_${++undoCount}`
    const until = lasting ? null : Date.now() + UNDO_SECONDS * 1000
    undos.set(token, { run: undo, by: me(), until })
    return { undo: { token, until: until === null ? null : new Date(until).toISOString() } }
  }
  /** Undo for a write over the store: exactly those cards, items and log line go back. */
  const revertTo = (
    before: State,
    touched: { cards?: string[]; facts?: string[]; entry?: string },
    lasting = false,
  ) =>
    remember(
      () =>
        dispatch({
          type: 'revert',
          before,
          cards: touched.cards ?? [],
          facts: touched.facts ?? [],
          entry: touched.entry,
        }),
      lasting,
    )

  const same = (a: string, b: string) => termWord(a) === termWord(b)
  const domainOf = (id: string) => workspace.domains().find((d) => d.id === id)
  /** The cards a family split gave the owners of each item about it, one per owner (D2). */
  let splitCards: InboxCard[] = []
  /** The items a split left due, as they were and as the split changed them: kept past a sign-in. */
  const splitItems = new Map<
    string,
    {
      family: string
      before: Pick<Fact, 'status' | 'outOfDate' | 'where'>
      patch: Partial<Fact>
    }
  >()
  /** The Inbox as the person sees it: none of the demo's cards on a new install. */
  const inbox = (): Inbox => {
    const titleOf = (subject: Subject) => {
      const [kind, id] = subject.split(':')
      return (
        (kind === 'context'
          ? factsOf(state).find((f) => f.id === id)?.title
          : cards.find((c) => c.id === id)?.title) ?? 'A comment'
      )
    }
    const nameCard = names.card(me(), obsReader())
    return {
      cards: [...(nameCard ? [nameCard] : []), ...splitCards, ...(state.fresh ? [] : cards)],
      waiting: state.fresh ? [] : waiting,
      sent: state.sent,
      done: state.done,
      opened: state.opened,
      reviewed: state.reviewed,
      week,
      mentions: (mentionNotesOf(comments.read()).get(me()) ?? []).map((n) => ({
        ...n,
        title: titleOf(n.subject),
      })),
    }
  }

  /** A decision on a suggestion: its effects, the card done, and Undo for exactly those. */
  const decideReview = (
    id: string,
    outcome: string,
    effects: () => { cards?: string[]; facts?: string[]; also?: () => void } | void,
  ) => {
    const before = state
    const touched = effects() ?? {}
    dispatch({ type: 'complete', card: id, outcome })
    const r = reviews.find((x) => x.id === id)
    return remember(() => {
      dispatch({
        type: 'revert',
        before,
        cards: [id, ...(touched.cards ?? [])],
        facts: touched.facts ?? (r ? touchedBy(r) : []),
      })
      touched.also?.()
    })
  }

  /** Why a move is not offered for a suggestion, in the service's words. */
  const notOffered = (action: ReviewAction, r: Review) =>
    action === 'close'
      ? 'Only a suggestion of a context item is closed. Decide this one instead.'
      : action === 'archive'
        ? 'Only a suggestion to archive is archived. Publish or return this one.'
        : r.mode === 'retire'
          ? `A suggestion to archive is archived or closed, not ${action === 'publish' ? 'published' : 'returned'}.`
          : 'Nobody wrote this draft, so there is no note to answer. Publish it or edit it.'
  /**
   * As the service, before every decision: a suggestion is decided while it waits, once, by an
   * owner of its domain or an admin, and only with a move `reviewActions` offers for it.
   */
  const mayDecide = (id: string, action: ReviewAction) => {
    const r = reviews.find((x) => x.id === id)
    const card = cards.find((c) => c.id === id)
    if (!r || !card || state.fresh) throw new ApiError('not-found', missing('this suggestion'))
    if (state.done[id])
      throw new ApiError('conflict', 'This suggestion no longer waits for a decision.')
    const who = meAsPerson()
    if (!who.admin && !who.owns.includes(card.domain))
      throw new ApiError('forbidden', 'Only an owner of its domain, or an admin, decides it.')
    const { can } = reviewActions({
      mode: r.mode,
      withdrawn: !!reviewNow(r).retire?.withdrawn,
      stale: !!r.stale,
      clashes: 0,
      claimsToCheck: 0,
      drafted: !!r.drafted,
    })
    if (!can.includes(action)) throw new ApiError('conflict', notOffered(action, r))
  }

  /** The words of the new items sent this visit, by their suggestion's id: Context lists them. */
  const sentFacts = new Map<string, Fact>()
  /**
   * The new items waiting for review that the person may open, as Context lists them: a review's
   * new item while its card waits, in a domain they decide for or sent by them, and a new item they
   * sent this visit. As the service: a change waits on its item's page instead.
   */
  const waitingFacts = (): Fact[] => {
    if (state.fresh) return []
    const who = meAsPerson()
    const domains = workspace.domainMap()
    const reviewed = reviews.flatMap((r): Fact[] => {
      const card = cards.find((c) => c.id === r.id)
      if (r.mode !== 'new' || r.drafted || !card || state.done[r.id]) return []
      if (!who.admin && !who.owns.includes(card.domain) && r.from !== me()) return []
      const item = draftItem(r, undefined, domains)
      const sent = parseDay(r.on)
      return item
        ? [
            {
              ...item,
              id: r.id,
              domain: card.domain,
              status: 'Waiting',
              by: r.synced ? '' : r.from,
              ...(sent ? { sentAt: new Date(sent).toISOString().slice(0, 10) } : {}),
            },
          ]
        : []
    })
    const sentNow = state.sent.flatMap((x): Fact[] => {
      const fact = sentFacts.get(x.id)
      return fact && x.by === me()
        ? [{ ...fact, id: x.id, status: 'Waiting', by: x.by, sentAt: today() }]
        : []
    })
    return [...reviewed, ...sentNow]
  }
  /** Context's rows: the items, the drafts, and what waits for review that the person may open. */
  const contextFacts = () => [...factsOf(state), ...waitingFacts()]

  /** The threads where `who` may take back what they hang on: a suggestion to archive they sent, while it waits. */
  const withdrawableBy = (who: string) =>
    Object.fromEntries(
      state.fresh
        ? []
        : reviews
            .filter((r) => r.mode === 'retire' && r.from === who && !state.done[r.id])
            .map((r) => [`review:${r.id}`, true]),
    )

  /** A suggestion as its review reads it now: a retirement says whether its sender took it back. */
  const reviewNow = (r: Review): Review => {
    if (!r.retire) return r
    const c = comments.withdrawal(`review:${r.id}`, r.from)
    const { withdrawn: _seeded, ...retire } = r.retire
    return {
      ...r,
      retire: c
        ? { ...retire, withdrawn: { by: c.author, when: c.when, quote: plainOf(c.content) } }
        : retire,
    }
  }

  const publishOne = (
    id: string,
    relations: Record<string, Relation> = {},
    saveQuestion = true,
  ) => {
    const r = reviews.find((x) => x.id === id)
    if (!r) return () => {}
    const { itemId, domain } = publishEffects(r, me(), dispatch, relations)
    return saved.afterPublish(r, me(), itemId, domain, saveQuestion)
  }

  /** The Conflicts filter's rows, as the person may see them: a pair kept as both and unchanged since is off it. */
  const conflictRows = (whose: 'mine' | 'all') => {
    const person = meAsPerson()
    const domains = workspace.domainMap()
    return pairsOf(factsOf(state))
      .filter(([h, o]) => !stillKept(keptPairs.get(`${h.id}.${o.id}`), h, o))
      .map(([h, o]) => rowOf(h, o, person, domains))
      .filter((r) => whose === 'all' || r.mine)
      .sort((a, b) => b.asked - a.asked || a.topic.localeCompare(b.topic))
  }

  /** Ask's answer: as the loop answers the question, or an example, on the demo week. */
  const answer = ({ question = '', parts, scope, example, period }: AskInput): Answer => {
    const found = example ? examples.find((e) => e.id === example) : undefined
    if (example && !found) throw new ApiError('not-found', 'This question is not offered any more.')
    const asked = found?.question ?? question
    const extra = {
      ...(parts?.some((p) => typeof p !== 'string') ? { parts } : {}),
      ...(scope?.length ? { scope } : {}),
      ...(period ? { period } : {}),
    }
    // The check could not run: what the page shows when the service does not answer.
    if (example === 'failed') return { ...failedAnswer(asked), id: example, ...extra }
    return { ...recordedAnswer(asked), ...(example ? { id: example } : {}), ...extra }
  }

  /** The reports the person sent from Ask this visit, newest first. */
  const reports: { id: string; question: string; at: Date }[] = []
  const ratings = new Map<string, 'helpful' | 'wrong'>()

  /** Who sets and turns off a policy to publish without review, by name; the review flag first. */
  const policyReader = () => {
    policies.fromAddress(scenario.address().query)
    return { name: me(), ...obsReader() }
  }
  /** Whether publishing without review is on in the demo, the review flag first. */
  const autoPublishOn = () => {
    policies.fromAddress(scenario.address().query)
    return policies.state().on
  }
  /** Who reads Observability and the names: an admin, or the owner of some domains. */
  const obsReader = () => {
    const person = workspace.people().find((p) => p.name === me())
    return { admin: !!person?.admin, owns: person?.owns ?? [] }
  }
  /** The domains a reader's raises are narrowed to, as row security does: null for an admin. */
  const ownedOf = () => {
    const reader = obsReader()
    return reader.admin ? null : reader.owns
  }
  const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value))
  const read = <T>(method: FootnoteApiMethod, key: string, run: () => T) =>
    scenario.read(method, key, () => copy(run()))
  // A rule the mock keeps (only its author edits a comment) refuses as the service does: the
  // promise rejects, never throws before it is returned.
  /** The app's own address, which an invite link leads back to. */
  const origin = () => globalThis.location?.origin ?? 'http://localhost'
  const now = <T>(run: () => T) => new Promise<T>((resolve) => resolve(copy(run())))
  /** The install's label, as FOOTNOTE_PROFILE_LABEL sets it: the address's ?label=, none without. */
  const profileLabel = () => scenario.address().query.label?.trim() || null

  const api: FootnoteApi = {
    // Session and workspace
    getSession: () =>
      now(() => ({
        user: state.user,
        install: state.install,
        fresh: state.fresh,
        profileLabel: profileLabel(),
        // The mock's Ask is its own reader in the browser, a design preview of Ask.
        answeredBy: 'preview',
      })),
    // The picker, with the address's label if any; an invite link opens the invite it names. Not
    // the demo install (demo: false), which lets a visitor in as its admin and has its own switch
    // between people: here every journey starts signed in, and signs in as others through the picker.
    getSignInMethod: () =>
      now(() => ({ kind: 'picker' as const, demo: false, profileLabel: profileLabel() })),
    readInvite: ({ token }) => now(() => workspace.readInvite(token)),
    // The mock's people are all invented, as the demo's are.
    listSignInPeople: () =>
      now(() =>
        signInPeople.map((name) => ({
          name,
          admin: !!workspace.person(name)?.admin,
          sample: true,
        })),
      ),
    signIn: ({ name }) => {
      if (!signInPeople.includes(name))
        return Promise.reject(new ApiError('not-found', `${name} can't sign in here.`))
      return now(() => {
        dispatch({ type: 'signIn', name })
        // The families demo stays for whoever signs in: its context, as its families do.
        if (familiesShop) for (const fact of familyFacts()) dispatch({ type: 'addFact', fact })
        for (const [id, { patch }] of splitItems) dispatch({ type: 'editFact', id, patch })
        return {
          user: state.user,
          install: state.install,
          fresh: state.fresh,
          profileLabel: profileLabel(),
          answeredBy: 'preview',
        }
      })
    },
    signOut: () => now(() => dispatch({ type: 'signOut' })),
    getWorkspace: () =>
      now(() => ({
        name: WORKSPACE_NAME,
        domains: workspace.domains(),
        people: workspace.people(),
        invites: workspace.invites(),
        about: state.about,
        aboutTemplate: ABOUT_BUSINESS,
        setup: { done: state.setup, serverSource: null },
      })),
    getVocabulary: () =>
      now(() => ({
        // A family is one metric to write about (FR-142), with ?demo=families.
        metrics: [
          ...definitions
            .list()
            .filter((d) => d.family)
            .map((d) => ({ name: d.name, group: '', facts: 0, definition: '' })),
          ...metrics,
        ],
        dimensions,
        markets,
      })),
    getActivity: ({ name }) => now(() => workspace.activityOf(name, seedFacts)),
    setAbout: ({ text }) => now(() => dispatch({ type: 'about', text })),
    completeSetupStep: ({ step }) => now(() => dispatch({ type: 'setupStep', step })),

    // Domains and people
    updateDomain: (input) => now(() => workspace.updateDomain(input)),
    addDomain: (input) => now(() => ({ id: workspace.addDomain(input) })),
    // Only an empty domain is deleted, and never the sandbox, as the service refuses.
    removeDomain: ({ id }) =>
      now(() => {
        const domain = workspace.domainMap()[id]
        if (!domain)
          throw new ApiError('not-found', "We couldn't find this domain. It may have been deleted.")
        if (domain.sandbox)
          throw new ApiError(
            'conflict',
            "The sandbox can't be deleted. It is where people try context, and agents never get it.",
          )
        const holds =
          factsOf(state).some((f) => f.domain === id && servedToAgents(f)) ||
          definitions.list().some((d) => d.domain === id)
        if (holds)
          throw new ApiError(
            'conflict',
            'Only an empty domain can be deleted. Move its context and terms to another domain first.',
          )
        workspace.removeDomain(id)
      }),
    setOwner: ({ id, domain, own }) =>
      now(() =>
        workspace.setOwner(id, domain, own) === 'last'
          ? { done: false as const, last: true as const }
          : { done: true as const },
      ),
    setAdmin: ({ id, admin }) => now(() => workspace.setAdmin(id, admin)),
    invite: ({ emails, admin, owns }) =>
      now(() => workspace.invite(emails, admin, owns, origin(), meAsPerson().id)),
    resendInvite: ({ id }) =>
      now(() => {
        const link = workspace.resendInvite(id, origin())
        if (!link) throw new ApiError('not-found', 'This invite is not open any more.')
        return { link }
      }),
    revokeInvite: ({ id }) =>
      now(() => {
        const result = workspace.revokeInvite(id)
        if (!result) throw new ApiError('not-found', 'This invite is not open any more.')
        return remember(result.restore, true)
      }),
    removePerson: ({ id }) =>
      now(() => {
        const result = workspace.removePerson(id)
        return 'alone' in result
          ? { removed: false as const, alone: result.alone }
          : { removed: true as const, ...remember(result.restore, true) }
      }),

    // The library
    getLibrary: () =>
      now(() => ({
        items: contextFacts(),
        published: state.published,
        viewed: state.viewed,
        log: state.log,
      })),
    searchAll: ({ q }) =>
      now(() =>
        searchWorld(q, {
          facts: factsOf(state),
          definitions: definitions.list(),
          domains: workspace.domains(),
          people: workspace.people(),
        }),
      ),
    searchScope: (input) =>
      now(() =>
        scope.search(
          input,
          factsOf(state),
          definitions.list().filter((d) => d.family),
        ),
      ),
    contextPage: () => read('contextPage', '', contextFacts),
    itemPage: ({ id }) =>
      read('itemPage', id, () => {
        const item = factsOf(state).find((f) => f.id === id)
        const waits = item ? undefined : waitingFacts().find((f) => f.id === id)
        if (waits) return { item: withScope(waits), history: [] }
        if (!item) return null
        // The pair its warning names, as the service's page carries it: no read of the pair.
        const pair = item.disagreesWith ? pairAt(item.id, item.disagreesWith) : undefined
        const conflict =
          pair && conflictOf(pair[0], pair[1], meAsPerson(), workspace.domainMap(), undefined)
        return {
          item: withScope(item),
          history: historyOf(item, state.log),
          ...(conflict
            ? {
                conflict: {
                  key: conflict.key,
                  canSettle: Object.values(conflict.rights).some(Boolean),
                  asked: conflict.asked,
                },
              }
            : {}),
        }
      }),
    conflicts: ({ whose }) => read('conflicts', whose, () => conflictRows(whose)),
    conflict: ({ holderId, otherId }) =>
      read('conflict', `${holderId}.${otherId}`, () => {
        const pair = pairAt(holderId, otherId)
        if (!pair) return null
        const [h, o] = pair
        return conflictOf(
          h,
          o,
          meAsPerson(),
          workspace.domainMap(),
          keptPairs.get(`${h.id}.${o.id}`),
        )
      }),
    settleConflict: (input) =>
      now(() => {
        const pair = pairAt(input.holderId, input.otherId)
        if (!pair)
          throw new ApiError(
            'conflict',
            'Someone settled this already, or one of the two changed. There is nothing left to decide here.',
          )
        const [holder, other] = pair
        const person = meAsPerson()
        const rights = rightsOf(person, holder, other, workspace.domainMap())
        const keep =
          input.outcome === 'kept_one'
            ? input.keepId === holder.id
              ? 'holder'
              : input.keepId === other.id
                ? 'other'
                : null
            : null
        if (!input.reason.trim()) throw new ApiError('invalid', 'Say why, in a few words.')
        if (!maySettle(rights, input.outcome, keep))
          throw new ApiError(
            'forbidden',
            'Only an owner of the item it changes, or an admin, can do that.',
          )
        const key = `${holder.id}.${other.id}`
        const decision = {
          outcome: input.outcome,
          keptId: keep === 'holder' ? holder.id : keep === 'other' ? other.id : null,
          reason: input.reason.trim(),
          quote: input.quote?.trim() || null,
          by: me(),
          at: clockTime(new Date()),
        }
        const patches: Record<string, Partial<Fact>> = {}
        if (keep) {
          const [stays, goes] = keep === 'holder' ? [holder, other] : [other, holder]
          patches[goes.id] = { status: 'Archived' }
          if (stays.disagreesWith === goes.id) patches[stays.id] = { disagreesWith: undefined }
        }
        if (input.outcome === 'not_conflict')
          for (const f of [holder, other])
            if (f.disagreesWith) patches[f.id] = { disagreesWith: undefined }
        const summary =
          input.outcome === 'kept_one'
            ? `Settled a conflict: kept one, archived the other. Reason: ${decision.reason}`
            : input.outcome === 'kept_both'
              ? `Kept both items of a conflict. Reason: ${decision.reason}`
              : `Not a conflict: the Conflict mark was removed. Reason: ${decision.reason}`
        const entry = {
          id: `log-settled-${key}-${Date.now()}`,
          on: TODAY,
          who: me(),
          what: 'settled' as const,
          summary,
          items: [holder, other].map((f) => ({ id: f.id, title: f.title, domain: f.domain })),
        }
        const before = state
        const keptBefore = keptPairs.get(key)
        dispatch({ type: 'bulk', patches, remove: [], entry })
        if (input.outcome === 'kept_both')
          keptPairs.set(key, {
            decision,
            stamps: { [holder.id]: stampOf(holder), [other.id]: stampOf(other) },
          })
        const { undo } = revertTo(before, { facts: [holder.id, other.id], entry: entry.id })
        const offer = undos.get(undo.token)!
        undos.set(undo.token, {
          ...offer,
          run: () => {
            offer.run()
            if (keptBefore) keptPairs.set(key, keptBefore)
            else keptPairs.delete(key)
          },
        })
        return { undo, decision }
      }),
    suggestArchiving: ({ id }) =>
      now(() => {
        const item = factsOf(state).find((f) => f.id === id)
        if (!item) throw new ApiError('not-found', "This context item isn't in Context any more.")
        const owners = workspace.domainMap()[item.domain]?.owners ?? []
        dispatch({
          type: 'send',
          sent: {
            id: `sent_${Date.now().toString(36)}`,
            factId: id,
            title: `Archive “${item.title}”`,
            by: me(),
            to: owners[0] ?? 'the owners',
            domain: item.domain,
            at: 'just now',
          },
        })
      }),
    getItemHistory: ({ id }) =>
      now(() => {
        const fact = factsOf(state).find((f) => f.id === id)
        return fact ? historyOf(fact, state.log) : []
      }),
    compareVersions: ({ id, from, to }) =>
      now(() => {
        const fact = factsOf(state).find((f) => f.id === id)
        return fact ? versionPairOf(fact, historyOf(fact, state.log), from, to) : null
      }),
    getRelated: ({ id }) =>
      now(() => ({
        links: linksOf(id, {
          facts: factsOf(state),
          definitions: definitions.list(),
          domains: Object.fromEntries(workspace.domains().map((d) => [d.id, d])),
        }),
        following: settings.read(scenario.address()).links,
      })),
    // The item's words as they are now: the demo's versions are made up, so each restores the same.
    restoreAsDraft: ({ id }) =>
      now(() => {
        const item = factsOf(state).find((f) => f.id === id)
        if (!item) throw new ApiError('not-found', "This context item isn't in Context any more.")
        const draft = `itm_draft_${Date.now().toString(36)}`
        dispatch({
          type: 'addFact',
          fact: { ...item, id: draft, status: 'Draft', by: me(), checkedBy: '', checkedOn: '' },
        })
        return { id: draft }
      }),
    markViewed: ({ id }) => now(() => dispatch({ type: 'viewedFact', id })),
    editItem: ({ id, patch }) => now(() => dispatch({ type: 'editFact', id, patch })),
    draftFromText: () => now(() => withScope(norwayDraft)),
    saveItem: ({ fact, isNew, relations = {}, gap, setup }) =>
      now(() => {
        // An owner's words in a new item waiting for their review publish that suggestion as
        // itself (Edit then publish), as the service does: its card is decided.
        const waits = isNew ? undefined : waitingFacts().find((f) => f.id === fact.id)
        if (waits) {
          if (sentFacts.has(fact.id))
            throw new ApiError(
              'conflict',
              'It is waiting for review. Withdraw it to change it, then send it again.',
            )
          mayDecide(fact.id, 'publish')
          const itemId = `itm_new_${Date.now().toString(36)}`
          scope.used(fact.scope)
          dispatch({ type: 'addFact', fact: { ...fact, id: itemId, version: 1, by: waits.by } })
          dispatch({ type: 'complete', card: fact.id, outcome: 'Published' })
          dispatch({ type: 'published', id: itemId })
          return { id: itemId }
        }
        // As the service: an overlap left alone is unrelated, so none refuses a publish.
        const id = isNew ? `itm_new_${Date.now().toString(36)}` : fact.id
        // As the service: an edit from an older version than the one published now changes nothing.
        const current = isNew ? undefined : factsOf(state).find((f) => f.id === id)
        const at = current ? (current.version ?? 1) : 0
        if (current && fact.version !== undefined && fact.version !== at)
          throw new ApiError(
            'conflict',
            `${current.checkedBy || 'Someone'} published a change to this context item after you opened it, so nothing was saved. Reload it to see their words; yours stay here.`,
            { status: 409, stale: at },
          )
        // What the owner said of an overlap is kept on the item, as a published suggestion's is.
        const related = Object.entries(relations)
        const replaces = related.find(([, r]) => r === 'replaces')?.[0]
        const disagreesWith = related.find(([, r]) => r === 'disagree')?.[0]
        const saved = {
          ...fact,
          version: at + 1,
          ...(replaces ? { replaces } : {}),
          ...(disagreesWith ? { disagreesWith } : {}),
        }
        scope.used(fact.scope)
        if (isNew) dispatch({ type: 'addFact', fact: { ...saved, id } })
        else dispatch({ type: 'editFact', id, patch: saved })
        dispatch({ type: 'published', id })
        if (gap) dispatch({ type: 'complete', card: gap, outcome: 'Context written' })
        if (setup) dispatch({ type: 'setupStep', step: 'fact' })
        return { id }
      }),
    applyBulk: ({ patches, remove, suggest = [], entry }) =>
      now(() => {
        const rows = [...new Set([...Object.keys(patches), ...remove, ...suggest])]
        // ?bulk=fail: the first change to many rows fails on its last row, so a partial failure can be seen.
        const failed = rows.length > 1 && scenario.failsOnce('bulk') ? rows.slice(-1) : []
        const done = rows.filter((id) => !failed.includes(id))
        const before = state
        // A draft sent to its domain's owners leaves the list and waits for them, as from the editor.
        const sent = suggest.filter((id) => done.includes(id))
        for (const id of sent) {
          const draft = factsOf(state).find((f) => f.id === id)
          if (!draft) continue
          const to = workspace.domains().find((d) => d.id === draft.domain)?.owners[0] ?? ''
          dispatch({
            type: 'send',
            sent: {
              id: `sent_${id}`,
              title: draft.title,
              by: me(),
              to,
              domain: draft.domain,
              at: 'just now',
            },
          })
        }
        dispatch({
          type: 'bulk',
          patches: Object.fromEntries(Object.entries(patches).filter(([id]) => done.includes(id))),
          remove: [...remove, ...sent].filter((id) => done.includes(id)),
          entry: { ...entry, items: entry.items.filter((i) => done.includes(i.id)) },
        })
        for (const id of done)
          if (patches[id]?.status === 'Live') dispatch({ type: 'published', id })
        const offer = revertTo(before, { facts: done, entry: entry.id })
        if (sent.length) {
          const undo = undos.get(offer.undo.token)!
          undos.set(offer.undo.token, {
            ...undo,
            run: () => {
              undo.run()
              for (const id of sent) dispatch({ type: 'withdraw', id: `sent_${id}` })
            },
          })
        }
        return { done, failed, ...offer }
      }),
    sendSuggestion: ({ fact, sent }) =>
      now(() => {
        scope.used(fact.scope)
        const id = `sent_${Date.now().toString(36)}`
        if (!sent.factId) sentFacts.set(id, fact)
        dispatch({ type: 'send', sent: { ...sent, id } })
        return { id }
      }),
    withdrawSuggestion: ({ id }) =>
      now(() => {
        dispatch({ type: 'withdraw', id })
        const r = reviews.find((x) => x.id === id)
        if (r && r.from === me() && !state.done[id])
          dispatch({ type: 'complete', card: id, outcome: 'Withdrawn' })
      }),
    undo: ({ token }) =>
      now(() => {
        const offer = undos.get(token)
        if (!offer) throw new ApiError('conflict', 'This decision is already undone.')
        if (offer.by !== me())
          throw new ApiError('forbidden', 'Only the person who decided can undo it.')
        if (offer.until !== null && Date.now() >= offer.until)
          throw new ApiError(
            'conflict',
            'It is too late to undo this decision. Change it again instead.',
          )
        undos.delete(token)
        offer.run()
      }),

    // Comments
    getComments: () => now(() => comments.read(withdrawableBy(me()))),
    postComment: ({ subject, content, parentId, returned, anchor }) =>
      now(() => ({ id: comments.post(subject, me(), content, { parentId, returned, anchor }) })),
    resolveComment: ({ subject, id, resolved }) =>
      now(() => comments.resolve(subject, id, me(), resolved)),
    reactToComment: ({ subject, id, emoji }) => now(() => comments.react(subject, id, emoji, me())),
    reactToSubject: ({ subject, emoji }) =>
      now(() => comments.reactToSubject(subject, emoji, me())),
    editComment: ({ subject, id, content }) => now(() => comments.edit(subject, id, content, me())),
    removeComment: ({ subject, id }) => now(() => comments.remove(subject, id, me())),
    withdrawWithComment: ({ subject, id, withdrew }) =>
      now(() => {
        if (!withdrawableBy(me())[subject])
          throw new ApiError(
            'conflict',
            'Only the person who suggested archiving it takes it back here, while it waits for a decision.',
          )
        comments.withdraw(subject, id, me(), withdrew)
      }),
    markThreadSeen: ({ subject }) => now(() => comments.seen(subject)),
    markMentionSeen: ({ subject }) => now(() => comments.seenMention(subject, me())),

    // Definitions
    getDefinitions: () => now(() => definitions.list()),
    definitionsPage: () => read('definitionsPage', '', () => definitions.list()),
    definitionPage: ({ name }) =>
      read(
        'definitionPage',
        name,
        () => definitions.list().find((d) => d.name.toLowerCase() === name.toLowerCase()) ?? null,
      ),
    getDefinitionRelations: ({ name }) => now(() => relationsFor(name, definitions.list())),
    getDefinitionHistory: ({ name }) =>
      now(() => {
        const d = definitions.list().find((x) => x.name.toLowerCase() === name.toLowerCase())
        if (!d) return []
        const read = historyOfDefinition(d, d.tool ?? demoTool(DEMO_DEFINITIONS))
        return d.family
          ? [
              ...familyMeaningHistoryOf(
                definitions.familyMeaningHistory(d.name),
                (by) => by,
                (at) => at.slice(0, 10),
              ),
              ...read,
            ]
          : read
      }),
    setFamilyMeaning: (input) =>
      now(() => {
        const d = definitions.list().find((x) => x.family && x.name === input.name)
        const person = meAsPerson()
        if (d && !person.admin && !(d.domain && person.owns.includes(d.domain)))
          throw new ApiError(
            'forbidden',
            'Only an owner of its domain, or an admin, can change what it means.',
          )
        definitions.setFamilyMeaning(input, me())
      }),
    setFamilyUsual: (input) =>
      now(() => {
        const d = definitions.list().find((x) => x.family && x.name === input.name)
        const person = meAsPerson()
        if (d && !person.admin && !(d.domain && person.owns.includes(d.domain)))
          throw new ApiError(
            'forbidden',
            'Only an owner of its domain, or an admin, can pick its usual variant.',
          )
        definitions.setFamilyUsual(input, me())
      }),
    splitFamily: ({ name }) =>
      now(() => {
        const d = definitions.list().find((x) => x.family && same(x.name, name))
        const person = meAsPerson()
        if (d && !person.admin && !(d.domain && person.owns.includes(d.domain)))
          throw new ApiError(
            'forbidden',
            `Only an owner of ${domainOf(d.domain ?? '')?.name ?? 'its domain'} or an admin can split it.`,
          )
        // The items about it: no word changes, each applies to every former variant, due for a
        // check, and each owner of its domain gets a card for it (D2).
        const about = factsOf(state).filter(
          (f) => servedToAgents(f) && f.where.some((w) => same(w, name)),
        )
        const metrics = definitions.splitFamily(name, me(), about.length)
        for (const fact of about) {
          const patch: Partial<Fact> = {
            where: [...new Set(fact.where.flatMap((w) => (same(w, name) ? metrics : [w])))],
            status: 'Due for a check',
            outOfDate: splitDue(d!.name),
          }
          splitItems.set(fact.id, {
            family: d!.name,
            before: { status: fact.status, outOfDate: fact.outOfDate, where: fact.where },
            patch,
          })
          dispatch({ type: 'editFact', id: fact.id, patch })
          for (const owner of domainOf(fact.domain)?.owners ?? [])
            splitCards = [
              ...splitCards.filter((c) => c.id !== `check-split.${fact.id}.${owner}`),
              {
                id: `check-split.${fact.id}.${owner}`,
                type: 'check',
                domain: fact.domain,
                for: owner,
                when: 'Today',
                title: fact.title,
                due: 'family',
                splitInto: metrics,
                line: splitCardLine(d!.name, metrics),
                detail: fact.checkedBy
                  ? `Last checked by ${fact.checkedBy === owner ? 'you' : fact.checkedBy}, ${fact.checkedOn}.`
                  : 'Not checked yet.',
                primary: keepLabel(metrics.length),
                secondary: ['Edit', 'Archive'],
                factId: fact.id,
              },
            ]
        }
        return { metrics, items: about.length }
      }),
    joinFamily: ({ name }) =>
      now(() => {
        const split = definitions.splits(() => 0).find((x) => same(x.name, name))
        const person = meAsPerson()
        if (split && !person.admin && !(split.domain && person.owns.includes(split.domain)))
          throw new ApiError(
            'forbidden',
            `Only an owner of ${domainOf(split.domain ?? '')?.name ?? 'its domain'} or an admin can make them one family again.`,
          )
        definitions.joinFamily(name)
        const restored: string[] = []
        // The items it left due are about the family again, and their cards go.
        for (const fact of factsOf(state).filter(
          (f) => f.status === 'Due for a check' && f.outOfDate === splitDue(name),
        )) {
          restored.push(fact.id)
          const was = splitItems.get(fact.id)?.before
          dispatch({
            type: 'editFact',
            id: fact.id,
            patch: {
              where: [
                ...new Set(
                  fact.where.flatMap((w) =>
                    split!.metrics.some((m) => same(m, w)) ? [split!.name] : [w],
                  ),
                ),
              ],
              status: was?.status ?? 'Live',
              outOfDate: was?.outOfDate,
            },
          })
        }
        for (const [id, item] of splitItems) if (same(item.family, name)) splitItems.delete(id)
        splitCards = splitCards.filter(
          (c) =>
            !restored.includes(c.factId!) &&
            !factsOf(state).some((f) => f.id === c.factId && f.status === 'Live'),
        )
      }),
    getFamilySplits: () =>
      now(() =>
        definitions.splits(
          (family) =>
            factsOf(state).filter(
              (f) => f.status === 'Due for a check' && f.outOfDate === splitDue(family),
            ).length,
        ),
      ),
    saveTerm: ({ previous, term }) => now(() => definitions.saveTerm(previous, term)),
    addSynonym: ({ target, word }) => now(() => definitions.addSynonym(target, word, me())),
    removeTerm: ({ name }) => now(() => remember(definitions.removeTerm(name))),
    deleteTerms: ({ names, entry }) =>
      now(() => {
        const restore = definitions.deleteTerms(names)
        dispatch({ type: 'bulk', patches: {}, remove: [], entry })
        return remember(() => {
          restore()
          dispatch({ type: 'unlog', entry: entry.id })
        })
      }),
    moveTerms: ({ names, domain }) => now(() => remember(definitions.moveTerms(names, domain))),

    // The Inbox and the review
    getInbox: () => now(inbox),
    inboxPage: () => read('inboxPage', '', inbox),
    getReviews: () => now(() => reviews.map(reviewNow)),
    getNames: () => names.read(obsReader()).then(copy),
    decideNames: async (input) => {
      const decided = await names.decide(input, obsReader())
      if (decided.accepted) dispatch({ type: 'setupStep', step: 'definitions' })
      return decided
    },
    markOpened: ({ ids }) => now(() => ids.forEach((card) => dispatch({ type: 'opened', card }))),
    markReviewed: ({ id }) => now(() => dispatch({ type: 'reviewed', card: id })),
    decideCard: ({ card, outcome, patch }) =>
      now(() => {
        const found = [...splitCards, ...cards].find((c) => c.id === card)
        const factId = found?.factId
        const before = state
        if (patch && factId) dispatch({ type: 'editFact', id: factId, patch })
        dispatch({ type: 'complete', card, outcome })
        // As the service: a gap set aside is opened again at any time, so its Undo has no end.
        const setAside = found?.type === 'gap' && outcome === 'Closed'
        return revertTo(before, { cards: [card], facts: patch && factId ? [factId] : [] }, setAside)
      }),
    completeCard: ({ card, outcome }) =>
      now(() => {
        const before = state
        dispatch({ type: 'complete', card, outcome })
        return revertTo(before, { cards: [card] })
      }),
    publishReview: ({ id, relations = {}, saveQuestion }) =>
      now(() => {
        mayDecide(id, 'publish')
        // As the service: every live item it overlaps needs its own answer first.
        const open = reviews
          .find((r) => r.id === id)
          ?.clash?.items.find((c) => !relations[c.factId])
        if (open)
          throw new ApiError(
            'invalid',
            `Say how this relates to “${open.title}” first: it replaces it, they disagree, or they are unrelated.`,
          )
        return decideReview(id, 'Published', () => ({
          also: publishOne(id, relations, saveQuestion),
        }))
      }),
    publishReviews: ({ ids }) =>
      now(() => {
        for (const id of ids) mayDecide(id, 'publish')
        const before = state
        const also = ids.map((id) => {
          const undo = publishOne(id)
          dispatch({ type: 'complete', card: id, outcome: 'Published' })
          return undo
        })
        const facts = reviews.filter((r) => ids.includes(r.id)).flatMap(touchedBy)
        return remember(() => {
          dispatch({ type: 'revert', before, cards: ids, facts })
          also.forEach((u) => u())
        })
      }),
    archiveReview: ({ id }) =>
      now(() => {
        mayDecide(id, 'archive')
        return decideReview(id, 'Archived', () => {
          const r = reviews.find((x) => x.id === id)
          if (r?.retire)
            dispatch({ type: 'editFact', id: r.retire.factId, patch: { status: 'Archived' } })
        })
      }),
    closeReview: ({ id, reason }) =>
      now(() => {
        mayDecide(id, 'close')
        const r = reviews.find((x) => x.id === id)!
        if (!reviewNow(r).retire?.withdrawn && !reason?.trim())
          throw new ApiError(
            'invalid',
            r.mode === 'retire'
              ? 'Write why you close it. The reason is kept with the decision.'
              : "Write why you don't publish it. Its sender reads the reason.",
          )
        return decideReview(id, 'Closed', () => {})
      }),
    returnReview: ({ id, note }) =>
      now(() => {
        mayDecide(id, 'return')
        return decideReview(id, 'Returned', () => {
          const subject: Subject = `review:${id}`
          const posted = comments.post(subject, me(), note, { returned: true })
          return { also: () => comments.unpost(subject, posted) }
        })
      }),

    // Ask
    readQuestion: ({ question }) =>
      now(() => {
        const read = readQuestion(question)
        return { metric: read.metric, markets: read.markets }
      }),
    ask: (input, live) => {
      // A typed question is asked of the service, so offline nothing comes back; an example is kept here.
      if (input.question && !input.example && scenario.offline())
        return Promise.reject(new ApiError('unanswered', "You're offline."))
      // Ask's loop answers, as the service wrote them on the demo week: shown by address only.
      if (input.example?.startsWith('loop-')) return loopExample(input.example)
      const answered = now(() => answer(input))
      // In a live chat it arrives as it would from the service: the working line, then the turn.
      return live?.onEvent ? answered.then((a) => playAnswer(a, live)) : answered
    },
    askedThisWeek: () => read('askedThisWeek', '', () => askedThisWeek(factsOf(state))),
    getAskExamples: () => now(() => examples),
    listChats: () =>
      now(() =>
        chats.list().map((t) => ({
          ...t,
          preview: answer(
            t.example ? { example: t.example } : { question: t.question },
          ).text.replace(/\[\d+\]/g, ''),
        })),
      ),
    saveChat: ({ id, question, answers }) =>
      now(() => (answers ? chats.keep(id, answers) : chats.add(id, question))),
    renameChat: ({ id, title }) => now(() => chats.rename(id, title)),
    deleteChat: ({ id }) => now(() => remember(chats.remove(id), true)),
    // A named report waits in this visit's memory; the demo's owners don't act on it here.
    reportAnswer: ({ question }) =>
      now(() => {
        const id = `report-${reports.length + 1}`
        reports.unshift({ id, question, at: new Date() })
        return { id }
      }),
    // The demo's owners don't see it here: it waits in this visit's memory, as a report does.
    tellOwner: () => now(() => ({ id: `gap-report-${reports.length + 1}` })),
    getMyReports: () =>
      now(() =>
        reports.map((r) => ({ id: r.id, question: r.question, on: reportedOn(r.at, new Date()) })),
      ),
    // A rating waits in this visit's memory with only its verdict, as the service keeps it.
    rateAnswer: ({ verdict }) =>
      now(() => {
        const id = globalThis.crypto.randomUUID()
        ratings.set(id, verdict)
        return { id }
      }),
    takeBackRating: ({ id }) => now(() => ({ taken: ratings.delete(id) })),

    // Observability
    observabilityPage: ({ section, ...view }) =>
      read('observabilityPage', JSON.stringify([section, view]), () => obsPageFor(view)),
    obsDimensions: (input) =>
      now(() => {
        const list = dimensionsOf(definitions.list(), obsPageFor(input), input)
        const known = new Set(list.dimensions.map((d) => d.key))
        return { ...list, pinned: pins.keys.filter((k) => known.has(k)) }
      }),
    pinDimensions: ({ pinned, reason }) =>
      now(() => {
        if (!workspace.person(me())?.admin)
          throw new ApiError('forbidden', 'Only an admin pins dimensions for the workspace.')
        pins = { keys: [...pinned], changed: { who: me(), when: 'Today', why: reason } }
      }),
    obsValues: (input) =>
      read('obsValues', JSON.stringify(input), () =>
        valuesOf(definitions.list(), obsPageFor(input), input),
      ),
    getSavedViews: () => now(() => views),
    saveView: ({ name, filters }) =>
      now(() => {
        const id = `v-${views.length + 1}`
        views = [...views, { id, name, filters, by: me(), custom: true }]
        return { id }
      }),
    removeView: ({ id }) =>
      now(() => {
        views = views.filter((v) => v.id !== id)
      }),
    replayTopic: ({ topic, when }) =>
      now(() => {
        if (scenario.failsOnce('replay', topic))
          throw new ApiError('failed', "Couldn't load this.", { status: 500 })
        const t = obsData('normal').topics.find((x) => x.id === topic)
        if (!t) return null
        const pool = factsOf(state)
        return {
          ...replay(t, when, pool),
          changed: changedSteps(t, pool),
          before: { label: BEFORE.label, title: BEFORE.title },
        }
      }),

    // Alerts
    getAlerts: () => now(() => alerts.read(ownedOf())),
    getRaised: (input) => now(() => alerts.raised(ownedOf(), input)),
    setAlertRule: ({ id, on }) => now(() => alerts.setOn(id, on)),
    muteAlert: ({ id, domains, muted }) => now(() => alerts.setMuted(id, domains, muted)),
    setAlertThreshold: ({ id, value }) => now(() => alerts.setThreshold(id, value)),

    // Settings, integrations and agents
    getSettings: () => now(() => settings.read(scenario.address())),
    setLinks: ({ on }) => now(() => settings.setLinks(on)),
    setTool: ({ name, on }) => now(() => settings.setTool(name, on)),
    setPause: (change) => now(() => settings.setPause(change)),
    createAccessKey: ({ name }) =>
      now(() => {
        if (!obsReader().admin)
          throw new ApiError('forbidden', 'Only an admin makes an access key.')
        const problem = agentNameProblem(name)
        if (problem) throw new ApiError('invalid', problem)
        settings.addKey(me(), name.trim())
        return { key: demoAccessKey() }
      }),
    renameAccessKey: ({ id, name }) =>
      now(() => {
        if (!obsReader().admin)
          throw new ApiError('forbidden', 'Only an admin renames an access key.')
        const problem = agentNameProblem(name)
        if (problem) throw new ApiError('invalid', problem)
        if (!settings.renameKey(id, name.trim()))
          throw new ApiError(
            'not-found',
            "We couldn't find this access key. It may be revoked already.",
          )
      }),
    advancedPage: () =>
      read('advancedPage', '', () =>
        advancedOf(state.log, state.about, autoPublishOn(), pins, automatic),
      ),
    setAutomaticRuns: ({ on, version }) =>
      now(() => {
        if (!obsReader().admin)
          throw new ApiError(
            'forbidden',
            'Only an admin turns on answer tests that run on their own.',
          )
        if (version !== automatic.version)
          throw new ApiError(
            'conflict',
            'Someone changed this setting after you opened it. Look at it again, then try again.',
          )
        automatic = {
          on,
          version: version + 1,
          changed: {
            who: me(),
            when: 'Today',
            why: on
              ? 'Turned on in Settings, Advanced, after reading what a run is estimated to cost.'
              : 'Turned off in Settings, Advanced.',
          },
        }
      }),
    checkHistory: () => now(() => ({ whole: true, entries: 1284 })),
    exportHistory: () => now(() => historyFile(state.log)),
    exportContext: () =>
      now(() =>
        contextFile(
          factsOf(state)
            .filter((f) => f.status !== 'Draft' && f.status !== 'Archived')
            .map((f) => ({ id: f.id, title: f.title })),
        ),
      ),
    setFigures: ({ source, on }) => now(() => settings.setFigures(source, on)),
    setDataContact: ({ source, name }) => now(() => settings.setContact(source, name)),
    setFigureConnection: ({ source, endpoint }) =>
      now(() => settings.setConnection(source, endpoint)),
    connectForm: ({ id }) =>
      read('connectForm', id, () =>
        connectFormFor(id, settings.read(scenario.address()).connected, kept.get(id)),
      ),
    // The checks take a moment, as a tool's do.
    testIntegration: ({ connector, config, secrets }) =>
      new Promise((resolve) => setTimeout(resolve, MOCK_TEST_MS)).then(() =>
        copy(
          testFor(
            connector,
            { config, secrets },
            scenario.address().query.views === 'many',
            familiesShop,
          ),
        ),
      ),
    connectIntegration: ({ connector, config, chosen, readsAll, reason }) =>
      now(() => {
        checkConnect(connector, { chosen, reason })
        settings.connect(connector)
        kept.set(connector, { config, chosen, readsAll, revision: 1 })
        // A definitions tool's read makes names, and the owner accepts them.
        if (connectorById(connector)?.kind === 'definitions') names.load(familiesShop)
        // A content tool's first read is at its next morning read; a definitions tool's now.
        return {
          id: connector,
          firstRead: connectorById(connector)?.kind === 'definitions' ? null : '07:00',
        }
      }),
    changeIntegration: ({ id, revision, config, chosen, readsAll, acceptLeftOut, reason }) =>
      now(() => {
        const tool = connectorById(id)
        if (!tool || !settings.read(scenario.address()).connected.includes(tool.id))
          throw new ApiError('not-found', "We couldn't find this source.")
        checkConnect(tool.id, { chosen, reason })
        // ?change=fail: someone else saves the tool's settings, as they are, just before this.
        if (scenario.failsOnce('change', tool.id)) {
          const theirs = connectFormFor(
            tool.id,
            settings.read(scenario.address()).connected,
            kept.get(tool.id),
          )!
          kept.set(tool.id, {
            config: Object.fromEntries(theirs.fields.map((f) => [f.key, f.value])),
            chosen: theirs.chosen,
            readsAll: theirs.readsAll,
            revision: (kept.get(tool.id)?.revision ?? 1) + 1,
          })
        }
        const current = kept.get(tool.id)?.revision ?? 1
        if (revision !== current)
          throw new ApiError(
            'conflict',
            'Someone changed this source after you opened it. Look at the latest version, then try again.',
          )
        const left = leftOutNow(tool.id, { readsAll, views: chosen.map((c) => c.id) })
        if (left.items.count && !acceptLeftOut)
          throw new ApiError(
            'invalid',
            `This stops reading definitions that ${left.items.count === 1 ? '1 live item relies' : `${left.items.count} live items rely`} on. Look at what it leaves out, then save again.`,
          )
        kept.set(tool.id, { config, chosen, readsAll, revision: current + 1 })
      }),
    integrationLeftOut: ({ id, readsAll, views }) =>
      read('integrationLeftOut', id, () => {
        const tool = connectorById(id)
        if (!tool || !settings.read(scenario.address()).connected.includes(tool.id))
          throw new ApiError('not-found', "We couldn't find this source.")
        return leftOutNow(tool.id, { readsAll, views })
      }),
    disconnectIntegration: ({ id }) =>
      now(() => {
        const tool = connectorById(id)
        if (!tool || !settings.read(scenario.address()).connected.includes(tool.id))
          throw new ApiError('not-found', "We couldn't find this source.")
        settings.disconnect(tool.id)
        kept.delete(tool.id)
      }),
    getIntegrations: () =>
      now(() => ({
        figureConnections: settings.connections(scenario.address(), integrations.paused),
      })),
    integrationsPage: () =>
      read('integrationsPage', '', () => integrations.page(scenario.address())),
    integrationPage: ({ id }) =>
      read('integrationPage', id, () => integrations.sourcePage(id, scenario.address())),
    readIntegration: ({ id }) => now(() => integrations.readAgain(id, new Date())),
    pauseIntegration: ({ id, paused }) => now(() => integrations.pause(id, paused)),
    readFigure: (asked) =>
      now(() => {
        // As the service: only a tool whose figures are on is asked, never one paused or broken.
        const shown = settings.connections(scenario.address(), integrations.paused)
        return figureFor(asked, (id) => shown[id]?.state === 'on')
      }),
    tryFigure: ({ source }) =>
      now(() =>
        figureTryFor(source, settings.connections(scenario.address(), integrations.paused)[source]),
      ),
    listAgentConnections: () =>
      now(() =>
        settings
          .agents(me(), obsReader().admin)
          .map((r) => ({ ...r, policies: policies.ofAgent(r.id, policyReader()) })),
      ),
    setAgentTool: ({ id, tool, on }) =>
      now(() => {
        if (!obsReader().admin)
          throw new ApiError('forbidden', 'Only an admin switches the tools of an agent.')
        if (settings.setAgentTool(id, tool, on, me()) === null)
          throw new ApiError('not-found', "We couldn't find this agent.")
      }),
    // An admin ends any agent; anyone else the apps they signed in with.
    revokeAgent: ({ id }) =>
      now(() => {
        const agent = settings.agent(id)
        if (!agent)
          throw new ApiError('not-found', "We couldn't find this agent. It may be revoked already.")
        if (!obsReader().admin && !(agent.kind === 'app' && agent.who === me()))
          throw new ApiError('forbidden', 'Only an admin revokes the agents of others.')
        settings.revoke(id)
        policies.endAgent(id)
      }),
    // Publishing without review (FR-421): off as the demo starts, with no policy anywhere.
    getAutoPublish: () =>
      now(() => {
        if (!policyReader().admin) throw new ApiError('forbidden', 'Only an admin sees this.')
        return policies.state()
      }),
    setAutoPublish: ({ on }) => now(() => policies.switchTo(on, policyReader())),
    getDomainPolicies: ({ domain }) =>
      now(() => policies.forDomain(domain, policyReader(), settings.agents(me(), true))),
    setAgentPolicy: ({ agentId, domain, perDay, reason }) =>
      now(() => {
        const agent = settings.agent(agentId)
        if (!agent) throw new ApiError('not-found', "We couldn't find this agent.")
        const name = workspace.domainMap()[domain]?.name
        if (!name) throw new ApiError('not-found', "We couldn't find this domain.")
        return policies.set({ agent, domain, domainName: name, perDay, reason }, policyReader())
      }),
    endAgentPolicy: ({ id }) => now(() => policies.end(id, policyReader())),
    checkConnect: ({ since, agent }) =>
      now(() => settings.check(scenario.address(), since, agent, me())),
    getConnectReview: () => now(() => settings.review(scenario.address(), me())),
    getConnectRequest: ({ id }) => now(() => settings.connectRequest(id)),
    // The demo has no agent to send the browser back to: either answer lands in the Inbox.
    answerConnectRequest: ({ id, allow }) =>
      settings.answerRequest(id, allow, me())
        ? now(() => ({ redirectTo: '/inbox' }))
        : Promise.reject(
            new ApiError(
              'not-found',
              'This request is no longer open. Connect from your agent again.',
            ),
          ),

    // Saved questions
    // ?quality=same shows the calm week, when every saved question answers as saved.
    getSavedQuestions: () =>
      now(() =>
        scenario.address().query.quality === 'same'
          ? saved.list().map((q) => ({
              ...q,
              result: 'same' as const,
              why: 'Same items, same sentence.',
              diff: undefined,
            }))
          : saved.list(),
      ),
    // ?quality=running holds a check at 5 of them; ?quality=failed shows one that stopped at 8.
    getSavedCheck: () =>
      now(() => {
        const flag = scenario.address().query.quality
        const total = saved.list().length
        const base = { total, checkedAt: saved.checkedAt(), trend: SAVED_TREND }
        if (flag === 'running') return { ...base, run: 'running' as const, checked: 5 }
        if (flag === 'failed') return { ...base, run: 'failed' as const, checked: 8 }
        const { run, checked, total: of } = saved.progress()
        return run === 'running'
          ? { ...base, run, checked, total: of }
          : { ...base, run, checked: 0 }
      }),
    checkSavedQuestions: ({ domain }) => {
      if (scenario.offline()) return Promise.reject(new ApiError('unanswered', "You're offline."))
      return saved.check(domain)
    },
    saveQuestion: ({ question }) =>
      now(() => {
        const id = saved.save(question)
        return { id, ...remember(() => saved.remove(id), true) }
      }),
    removeSavedQuestion: ({ id }) => now(() => saved.remove(id)),
    keepNewAnswer: ({ id }) => now(() => remember(saved.keepNew(id), true)),
  }

  // Every write is sent as the scenario plays a send: refused offline, failing its first try under
  // a fault flag. These take as long as a send does; every other write answers at once unless a
  // flag plays sends. ?decide=fail names the card it fails on.
  const timedSends: FootnoteApiMethod[] = [
    'settleConflict',
    'suggestArchiving',
    'saveItem',
    'sendSuggestion',
    'saveTerm',
    'addSynonym',
    'removeTerm',
    'decideCard',
    'publishReview',
    'publishReviews',
    'archiveReview',
    'closeReview',
    'returnReview',
  ]
  for (const method of footnoteApiMethods) {
    if ((readMethods as readonly string[]).includes(method)) continue
    const write = api[method] as (...args: unknown[]) => Promise<unknown>
    api[method] = ((...args: unknown[]) =>
      scenario.send(method, () => write(...args), {
        quick: !timedSends.includes(method),
        ...(method === 'decideCard'
          ? {
              key: (args[0] as Parameters<FootnoteApi['decideCard']>[0]).card,
              flag: 'decide' as const,
            }
          : {}),
      })) as never
  }

  const controls = {
    /** The app moved: the review flags in the address may change what the mock answers. */
    setAddress: (address: Address) => {
      const before = state
      const demo = address.query.demo
      const result = scenario.setAddress(address)
      let mentions = false
      if (demo !== lastDemo) {
        lastDemo = demo
        if (demo === 'names') names.load()
        if (demo === 'variants') definitions.loadVariants()
        if (demo === 'dbt') definitions.loadDbtFolder()
        if (demo === 'families') {
          familiesShop = true
          definitions.loadFamilies()
          names.load(true)
          // Context about a family, and about one of its variants alone, for its quick view.
          for (const fact of familyFacts())
            if (!factsOf(state).some((f) => f.id === fact.id)) dispatch({ type: 'addFact', fact })
        }
        // 21 drafts brought in from a wiki, to publish from the Context list at once.
        if (demo === 'imported')
          for (const fact of importedDrafts())
            if (!factsOf(state).some((f) => f.id === fact.id)) dispatch({ type: 'addFact', fact })
        if (demo === 'setup' || demo === 'done' || demo === 'week' || demo === 'last')
          dispatch({ type: 'demo', mode: demo })
        if ((demo === 'done' || demo === 'week') && state.user) {
          comments.scenario(demo, state.user)
          mentions = true
        }
      }
      return {
        fault: result.fault,
        data:
          result.data ||
          state !== before ||
          mentions ||
          demo === 'names' ||
          demo === 'variants' ||
          demo === 'dbt' ||
          demo === 'families',
      }
    },
    offline: scenario.offline,
    showsLoads: scenario.showsLoads,
    slowSwitch: scenario.slowSwitch,
    setSlow: scenario.setSlow,
    subscribe: scenario.subscribe,
  }
  let lastDemo: string | undefined
  // Once ?demo=families was opened, Test connection and a dbt connected read its shop's families.
  let familiesShop = false

  return { api, controls }
}

export type MockControls = ReturnType<typeof createMockApi>['controls']
