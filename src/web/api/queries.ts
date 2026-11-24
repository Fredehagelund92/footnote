import * as React from 'react'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import type { SourceRead } from '@domain/source-state'
import { api, mockControls, type FootnoteApi, type FootnoteApiMethod } from '@/api'
import {
  isPageRead,
  type readMethods,
  type Library,
  type ObsFilterView,
  type ObsPageInput,
  type ObsValuesInput,
  type ScopeSearchInput,
} from '@/api/client'
import { ApiError } from '@/api/errors'
import { reportSignedOut } from '@/api/query-client'
import type { AskInput } from '@/model/ask'
import type { FigureAsk } from '@/model/figures'
import type { Source } from '@/model/integrations'

// Reads and writes as the screens use them: one query factory per read, keyed in one place, and
// one table of what each write makes stale. A screen never names a cache itself.

/** Query keys in one place: the read's method first, then its input. */
export const queryKeys = {
  session: ['getSession'] as const,
  signInPeople: ['listSignInPeople'] as const,
  signInMethod: ['getSignInMethod'] as const,
  invite: ['readInvite'] as const,
  workspace: ['getWorkspace'] as const,
  vocabulary: ['getVocabulary'] as const,
  activity: (name: string) => ['getActivity', name] as const,
  library: ['getLibrary'] as const,
  search: (q: string) => ['searchAll', q] as const,
  scopeSearch: (input: ScopeSearchInput) => ['searchScope', input] as const,
  scopeSearches: ['searchScope'] as const,
  contextPage: ['contextPage'] as const,
  itemPage: (id: string) => ['itemPage', id] as const,
  conflicts: (whose: 'mine' | 'all') => ['conflicts', whose] as const,
  conflictLists: ['conflicts'] as const,
  conflict: (key: string) => ['conflict', key] as const,
  conflictPairs: ['conflict'] as const,
  itemPages: ['itemPage'] as const,
  itemHistory: (id: string) => ['getItemHistory', id] as const,
  itemHistories: ['getItemHistory'] as const,
  versionPairs: ['compareVersions'] as const,
  versionPair: (id: string, from: number, to: number) => ['compareVersions', id, from, to] as const,
  related: (id: string) => ['getRelated', id] as const,
  relateds: ['getRelated'] as const,
  draftFromText: (text: string) => ['draftFromText', text] as const,
  comments: ['getComments'] as const,
  definitions: ['getDefinitions'] as const,
  definitionsPage: ['definitionsPage'] as const,
  familySplits: ['getFamilySplits'] as const,
  definitionPage: (name: string) => ['definitionPage', name.toLowerCase()] as const,
  definitionPages: ['definitionPage'] as const,
  definitionRelations: (name: string) => ['getDefinitionRelations', name.toLowerCase()] as const,
  definitionRelationLists: ['getDefinitionRelations'] as const,
  definitionHistory: (name: string) => ['getDefinitionHistory', name.toLowerCase()] as const,
  definitionHistories: ['getDefinitionHistory'] as const,
  inbox: ['getInbox'] as const,
  inboxPage: ['inboxPage'] as const,
  names: ['getNames'] as const,
  reviews: ['getReviews'] as const,
  savedQuestions: ['getSavedQuestions'] as const,
  savedCheck: ['getSavedCheck'] as const,
  alerts: ['getAlerts'] as const,
  savedViews: ['getSavedViews'] as const,
  settings: ['getSettings'] as const,
  advancedPage: ['advancedPage'] as const,
  integrations: ['getIntegrations'] as const,
  integrationsPage: ['integrationsPage'] as const,
  integrationPage: (id: string) => ['integrationPage', id] as const,
  integrationPages: ['integrationPage'] as const,
  connectForm: (id: string) => ['connectForm', id] as const,
  integrationLeftOut: (id: string, readsAll: boolean, views: readonly string[]) =>
    ['integrationLeftOut', id, readsAll, [...views].sort()] as const,
  connectForms: ['connectForm'] as const,
  figure: (asked: FigureAsk) => ['readFigure', asked] as const,
  figures: ['readFigure'] as const,
  agentConnections: ['listAgentConnections'] as const,
  autoPublish: ['getAutoPublish'] as const,
  domainPolicies: (domain: string) => ['getDomainPolicies', domain] as const,
  allDomainPolicies: ['getDomainPolicies'] as const,
  connectReview: ['getConnectReview'] as const,
  connectRequest: ['getConnectRequest'] as const,
  observabilityPage: (input: ObsPageInput) => ['observabilityPage', input] as const,
  observabilityPages: ['observabilityPage'] as const,
  obsDimensions: (input: ObsFilterView) => ['obsDimensions', input] as const,
  obsDimensionLists: ['obsDimensions'] as const,
  obsValues: (input: ObsValuesInput) => ['obsValues', input] as const,
  obsValueLists: ['obsValues'] as const,
  replay: (topic: string, when: string) => ['replayTopic', topic, when] as const,
  replays: ['replayTopic'] as const,
  readQuestion: (question: string) => ['readQuestion', question] as const,
  ask: (input: AskInput) => ['ask', input] as const,
  asks: ['ask'] as const,
  askExamples: ['getAskExamples'] as const,
  askedWeek: ['askedThisWeek'] as const,
  chats: ['listChats'] as const,
  myReports: ['getMyReports'] as const,
}

export const sessionQuery = () =>
  queryOptions({ queryKey: queryKeys.session, queryFn: () => api.getSession() })

/** How this workspace signs people in: the picker, or the company's provider. */
export const signInMethodQuery = () =>
  queryOptions({
    queryKey: queryKeys.signInMethod,
    queryFn: () => api.getSignInMethod(),
    staleTime: Infinity,
  })

/** What an invite link's token opens, for the sign-in screen. */
export const inviteQuery = (token: string) =>
  queryOptions({
    queryKey: [...queryKeys.invite, token],
    queryFn: () => api.readInvite({ token }),
    staleTime: Infinity,
    retry: false,
  })

export const signInPeopleQuery = () =>
  queryOptions({
    queryKey: queryKeys.signInPeople,
    queryFn: () => api.listSignInPeople(),
    staleTime: Infinity,
  })

/** The workspace: its name, domains, people, what the business is about, the setup checklist. */
export const workspaceQuery = () =>
  queryOptions({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })

export const vocabularyQuery = () =>
  queryOptions({
    queryKey: queryKeys.vocabulary,
    queryFn: () => api.getVocabulary(),
    staleTime: Infinity,
  })

export const activityQuery = (name: string) =>
  queryOptions({ queryKey: queryKeys.activity(name), queryFn: () => api.getActivity({ name }) })

/** Every context item the person may read, and what this visit did to them. */
export const libraryQuery = () =>
  queryOptions({ queryKey: queryKeys.library, queryFn: () => api.getLibrary() })

/**
 * Search everywhere for some words. Each search reads afresh when it is shown again, so a change
 * made since shows; nothing else needs to invalidate it.
 */
export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: queryKeys.search(q),
    queryFn: () => api.searchAll({ q }),
    enabled: q.trim() !== '',
  })

/**
 * The "Applies to" picker's search. A page stays fresh for a minute, so typing back and forth
 * reads it once; a publish or a suggestion refreshes it, as the recent terms change then.
 */
export const scopeSearchQuery = (input: ScopeSearchInput) =>
  queryOptions({
    queryKey: queryKeys.scopeSearch(input),
    queryFn: () => api.searchScope(input),
    staleTime: 60_000,
  })

/**
 * The Context list: the library's items, which the shell already holds. While the library's answer
 * is fresh a visit reads nothing; once it is stale, the list and the shell share one read of it, so
 * the 1.4 MB of the demo's library is never read twice for one visit. The mock's review flags play
 * the page's own read instead, so its loading can be seen.
 */
export const contextPageQuery = () =>
  queryOptions({
    queryKey: queryKeys.contextPage,
    queryFn: async ({ client }) =>
      mockControls?.showsLoads()
        ? api.contextPage()
        : (await client.fetchQuery(libraryQuery())).items,
  })

export const itemPageQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.itemPage(id), queryFn: () => api.itemPage({ id }) })

/** The Conflicts list, mine or all. */
export const conflictsQuery = (whose: 'mine' | 'all') =>
  queryOptions({ queryKey: queryKeys.conflicts(whose), queryFn: () => api.conflicts({ whose }) })

/** One pair, by its address `holderId.otherId`. */
export const conflictQuery = (key: string) => {
  const [holderId = '', otherId = ''] = key.split('.')
  return queryOptions({
    queryKey: queryKeys.conflict(key),
    queryFn: () => api.conflict({ holderId, otherId }),
  })
}

export const itemHistoryQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.itemHistory(id), queryFn: () => api.getItemHistory({ id }) })

/** Two versions of an item, as History compares them. */
export const versionPairQuery = (id: string, from: number, to: number) =>
  queryOptions({
    queryKey: queryKeys.versionPair(id, from, to),
    queryFn: () => api.compareVersions({ id, from, to }),
  })

/** What an agent can follow from an item or a definition, as Related shows it. */
export const relatedQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.related(id), queryFn: () => api.getRelated({ id }) })

export const commentsQuery = () =>
  queryOptions({ queryKey: queryKeys.comments, queryFn: () => api.getComments() })

export const definitionsQuery = () =>
  queryOptions({ queryKey: queryKeys.definitions, queryFn: () => api.getDefinitions() })

export const definitionsPageQuery = () =>
  queryOptions({ queryKey: queryKeys.definitionsPage, queryFn: () => api.definitionsPage() })

export const familySplitsQuery = () =>
  queryOptions({ queryKey: queryKeys.familySplits, queryFn: () => api.getFamilySplits() })

export const definitionPageQuery = (name: string) =>
  queryOptions({
    queryKey: queryKeys.definitionPage(name),
    queryFn: () => api.definitionPage({ name }),
  })

export const definitionRelationsQuery = (name: string) =>
  queryOptions({
    queryKey: queryKeys.definitionRelations(name),
    queryFn: () => api.getDefinitionRelations({ name }),
  })

export const definitionHistoryQuery = (name: string) =>
  queryOptions({
    queryKey: queryKeys.definitionHistory(name),
    queryFn: () => api.getDefinitionHistory({ name }),
  })

export const inboxQuery = () =>
  queryOptions({ queryKey: queryKeys.inbox, queryFn: () => api.getInbox() })

export const namesQuery = () =>
  queryOptions({ queryKey: queryKeys.names, queryFn: () => api.getNames() })
export const inboxPageQuery = () =>
  queryOptions({ queryKey: queryKeys.inboxPage, queryFn: () => api.inboxPage() })

export const reviewsQuery = () =>
  queryOptions({ queryKey: queryKeys.reviews, queryFn: () => api.getReviews() })

export const settingsQuery = () =>
  queryOptions({ queryKey: queryKeys.settings, queryFn: () => api.getSettings() })

/** Settings, Advanced's own read. */
export const advancedPageQuery = () =>
  queryOptions({ queryKey: queryKeys.advancedPage, queryFn: () => api.advancedPage() })

export const integrationsQuery = () =>
  queryOptions({ queryKey: queryKeys.integrations, queryFn: () => api.getIntegrations() })

/**
 * While a tool waits for its read (queued, or being read), its row and its page ask again every
 * few seconds, so Queued and Reading end when the read does. A first read is queued and done
 * within seconds, so a queued one is asked about as often: at ten seconds, a finished read
 * showed Queued and no metrics for five.
 */
const PENDING_POLL_MS = 3_000
/** A tool's pending read; none while it is paused. */
const readOf = (source: Source | undefined) =>
  source?.state.intent === 'active' ? source.state.read : null
const pollFor = (reads: readonly (SourceRead | null | undefined)[]) =>
  reads.includes('reading') || reads.includes('queued') ? PENDING_POLL_MS : false

/** Settings › Integrations: the tools connected, and what can be connected. */
export const integrationsPageQuery = () =>
  queryOptions({
    queryKey: queryKeys.integrationsPage,
    queryFn: () => api.integrationsPage(),
    refetchInterval: (query) => pollFor(query.state.data?.sources.map(readOf) ?? []),
  })

/** One connected tool's page. */
export const integrationPageQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.integrationPage(id),
    queryFn: () => api.integrationPage({ id }),
    refetchInterval: (query) => pollFor([readOf(query.state.data?.source)]),
  })

/** The connect flow's form: a tool to connect, or one connected whose settings change. */
export const connectFormQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.connectForm(id), queryFn: () => api.connectForm({ id }) })

/** What a change of the views a definitions tool reads would stop reading; it changes nothing. */
export const integrationLeftOutQuery = (id: string, readsAll: boolean, views: readonly string[]) =>
  queryOptions({
    queryKey: queryKeys.integrationLeftOut(id, readsAll, views),
    queryFn: () => api.integrationLeftOut({ id, readsAll, views: [...views] }),
  })

export const figureQuery = (asked: FigureAsk) =>
  queryOptions({ queryKey: queryKeys.figure(asked), queryFn: () => api.readFigure(asked) })

export const agentConnectionsQuery = () =>
  queryOptions({
    queryKey: queryKeys.agentConnections,
    queryFn: () => api.listAgentConnections(),
  })

/** Publishing without review: the workspace switch, for an admin (FR-421). */
export const autoPublishQuery = () =>
  queryOptions({ queryKey: queryKeys.autoPublish, queryFn: () => api.getAutoPublish() })

/** One domain's policies to publish without review, and the apps one may be for. */
export const domainPoliciesQuery = (domain: string) =>
  queryOptions({
    queryKey: queryKeys.domainPolicies(domain),
    queryFn: () => api.getDomainPolicies({ domain }),
  })

export const connectReviewQuery = () =>
  queryOptions({ queryKey: queryKeys.connectReview, queryFn: () => api.getConnectReview() })

/**
 * An agent's sign-in waiting for the person's answer, for the consent page: read once while the
 * page is open, and forgotten when it closes, since an answer ends it.
 */
export const connectRequestQuery = (id: string) =>
  queryOptions({
    queryKey: [...queryKeys.connectRequest, id],
    queryFn: () => api.getConnectRequest({ id }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })

export const savedViewsQuery = () =>
  queryOptions({ queryKey: queryKeys.savedViews, queryFn: () => api.getSavedViews() })

export const alertsQuery = () =>
  queryOptions({ queryKey: queryKeys.alerts, queryFn: () => api.getAlerts() })

export const savedCheckQuery = () =>
  queryOptions({ queryKey: queryKeys.savedCheck, queryFn: () => api.getSavedCheck() })

/** Ask's answer to a question, from the context as it is now. */
export const askQuery = (input: AskInput) =>
  queryOptions({ queryKey: queryKeys.ask(input), queryFn: () => api.ask(input) })

export const askedWeekQuery = () =>
  queryOptions({ queryKey: queryKeys.askedWeek, queryFn: () => api.askedThisWeek() })

export const askExamplesQuery = () =>
  queryOptions({
    queryKey: queryKeys.askExamples,
    queryFn: () => api.getAskExamples(),
    staleTime: Infinity,
  })

export const chatsQuery = () =>
  queryOptions({ queryKey: queryKeys.chats, queryFn: () => api.listChats() })

/** The person's own reports from Ask, with what the owners did after each. */
export const myReportsQuery = () =>
  queryOptions({ queryKey: queryKeys.myReports, queryFn: () => api.getMyReports() })

/** What a question is read as: the same words always read the same, so it is kept. */
export const readQuestionQuery = (question: string) =>
  queryOptions({
    queryKey: queryKeys.readQuestion(question),
    queryFn: () => api.readQuestion({ question }),
    staleTime: Infinity,
  })

export const observabilityPageQuery = (input: ObsPageInput) =>
  queryOptions({
    queryKey: queryKeys.observabilityPage(input),
    queryFn: () => api.observabilityPage(input),
  })

/** Overview's filter, its first step: the dimensions, for a view and its filters. */
export const obsDimensionsQuery = (input: ObsFilterView) =>
  queryOptions({
    queryKey: queryKeys.obsDimensions(input),
    queryFn: () => api.obsDimensions(input),
  })

/** Its second step: a page of a dimension's values, or the words in every dimension. */
export const obsValuesQuery = (input: ObsValuesInput) =>
  queryOptions({
    queryKey: queryKeys.obsValues(input),
    queryFn: () => api.obsValues(input),
  })

/**
 * A dimension's first page of values, counted without its own filter (so a tick reads nothing
 * again): one read for its facet and the picker's step, so whichever opens second has them at once.
 */
export const dimensionValuesQuery = (
  view: ObsFilterView,
  dimension: string,
  q = '',
  sort: ObsValuesInput['sort'] = 'asked',
) =>
  obsValuesQuery({
    ...view,
    filters: view.filters.filter((f) => f.key !== dimension),
    dimension,
    q,
    sort,
  })

export const replayQuery = (topic: string, when: 'now' | 'before') =>
  queryOptions({
    queryKey: queryKeys.replay(topic, when),
    queryFn: () => api.replayTopic({ topic, when }),
  })

export const savedQuestionsQuery = () =>
  queryOptions({ queryKey: queryKeys.savedQuestions, queryFn: () => api.getSavedQuestions() })

/** A draft made from pasted text: a read, as it changes nothing until the writer publishes it. */
export const draftFromTextQuery = (text: string) =>
  queryOptions({
    queryKey: queryKeys.draftFromText(text),
    queryFn: () => api.draftFromText({ text }),
    staleTime: Infinity,
  })

/* ---------- the shared reads, loaded before the app is drawn ---------- */

/**
 * The shared reads the screens of a signed-in person use; the shell waits for them once
 * (App.tsx), so a screen reads them from the cache and never waits. Each screen's own load is a
 * page read instead (`*Page`), which its loading state shows.
 */
export const sharedQueries = () => [
  workspaceQuery(),
  vocabularyQuery(),
  libraryQuery(),
  commentsQuery(),
  definitionsQuery(),
  inboxQuery(),
  savedQuestionsQuery(),
  alertsQuery(),
  savedViewsQuery(),
  askExamplesQuery(),
  chatsQuery(),
  settingsQuery(),
  integrationsQuery(),
  agentConnectionsQuery(),
  connectReviewQuery(),
]

/**
 * The reviews, read with the others but waited for only on the Inbox: their read waits for the
 * Inbox's (api/http.ts), so the shell draws without them elsewhere, and a screen that reads them
 * there waits in its own loading state.
 */
export const laterQueries = () => [reviewsQuery()]

/**
 * Inside the dock, the shared reads are what the shell holds: opening a panel reads none of them
 * again. Each new observer of a read older than staleTime would otherwise fetch it once more, so a
 * quick view sent a dozen reads it does not need ahead of its own. The page behind keeps them as
 * fresh as before: a write refreshes what it changed, and so does the tab coming back.
 */
export const InDock = React.createContext(false)

/** A shared read's options as a place reads it: in the dock, without fetching it on mount. */
export const sharedReadIn = <O extends object>(options: O, inDock: boolean): O =>
  inDock ? { ...options, refetchOnMount: false } : options

const useSharedRead = <O extends object>(options: O): O =>
  sharedReadIn(options, React.useContext(InDock))

export const useSession = () => useSuspenseQuery(useSharedRead(sessionQuery())).data
/** The workspace, from the cache the shell filled. */
export const useWorkspace = () => useSuspenseQuery(useSharedRead(workspaceQuery())).data
/** The library, from the cache the shell filled. */
export const useLibrary = () => useSuspenseQuery(useSharedRead(libraryQuery())).data
export const useVocabulary = () => useSuspenseQuery(useSharedRead(vocabularyQuery())).data
export const useComments = () => useSuspenseQuery(useSharedRead(commentsQuery())).data
export const useDefinitions = () => useSuspenseQuery(useSharedRead(definitionsQuery())).data
export const useInbox = () => useSuspenseQuery(useSharedRead(inboxQuery())).data
export const useReviews = () => useSuspenseQuery(useSharedRead(reviewsQuery())).data
export const useSavedQuestions = () => useSuspenseQuery(useSharedRead(savedQuestionsQuery())).data
export const useAlerts = () => useSuspenseQuery(useSharedRead(alertsQuery())).data

export const useSavedViews = () => useSuspenseQuery(useSharedRead(savedViewsQuery())).data
export const useAskExamples = () => useSuspenseQuery(useSharedRead(askExamplesQuery())).data
export const useChats = () => useSuspenseQuery(useSharedRead(chatsQuery())).data
export const useSettings = () => useSuspenseQuery(useSharedRead(settingsQuery())).data
export const useIntegrations = () => useSuspenseQuery(useSharedRead(integrationsQuery())).data
export const useAgentConnections = () =>
  useSuspenseQuery(useSharedRead(agentConnectionsQuery())).data

/* ---------- writes ---------- */

type Method<K extends FootnoteApiMethod> = FootnoteApi[K]
type Read = (typeof readMethods)[number]
export type WriteOperation = Exclude<FootnoteApiMethod, Read>
export type WriteInput<K extends WriteOperation> = Parameters<Method<K>>[0]
export type WriteResult<K extends WriteOperation> = Awaited<ReturnType<Method<K>>>

/** Everything cached: what a sign-in, a sign-out or an Undo may have changed. */
const everything: QueryKey[] = [[]]
/** What a change to the workspace makes stale: its people and domains, and who owns what. */
const workspace: QueryKey[] = [queryKeys.workspace]
/** What a change to context items makes stale: every read of them. */
const items: QueryKey[] = [
  queryKeys.library,
  queryKeys.contextPage,
  queryKeys.itemPages,
  queryKeys.itemHistories,
  queryKeys.versionPairs,
  queryKeys.relateds,
  queryKeys.replays,
  queryKeys.asks,
  queryKeys.chats,
  queryKeys.askedWeek,
  // What an owner did to an item is a report's outcome.
  queryKeys.myReports,
  // A change to an item may start or end a conflict, or bring a kept pair back.
  queryKeys.conflictLists,
  queryKeys.conflictPairs,
  // A split family counts the items still about it.
  queryKeys.familySplits,
]
/** What a change to comments makes stale: the threads, and the Inbox's mentions. */
const comments: QueryKey[] = [queryKeys.comments, queryKeys.inbox, queryKeys.inboxPage]
const definitions: QueryKey[] = [
  queryKeys.definitions,
  queryKeys.definitionsPage,
  queryKeys.familySplits,
  queryKeys.definitionPages,
  queryKeys.definitionRelationLists,
  queryKeys.definitionHistories,
  queryKeys.relateds,
  // A synonym changes how a question is read.
  queryKeys.asks,
  queryKeys.chats,
  queryKeys.askedWeek,
]
const inbox: QueryKey[] = [queryKeys.inbox, queryKeys.inboxPage, queryKeys.myReports]
/** What a change to a connected tool makes stale: its row, its page, and its connect form. */
const integrations: QueryKey[] = [
  queryKeys.integrationsPage,
  queryKeys.integrationPages,
  queryKeys.connectForms,
]
/**
 * What a new live version of an item makes stale besides the items: the reviews, since a suggestion
 * written against the version before is stale now (src/domain/suggestion-standing.ts).
 */
const live: QueryKey[] = [...items, queryKeys.reviews]
/** What a decision on a suggestion makes stale: the Inbox, the items it changed, the saved questions. */
const decision: QueryKey[] = [...inbox, ...live, queryKeys.savedQuestions, queryKeys.comments]

/**
 * What each write makes stale. A screen never names caches itself: a write goes through
 * `useApiWrite`, which refreshes these after the binding answers.
 */
export const invalidations: {
  [K in WriteOperation]: (input: WriteInput<K>, result: WriteResult<K>) => QueryKey[]
} = {
  signIn: () => everything,
  // Only the session: the shell then closes. Every read refetched while it is still open would be
  // 401 requests from a signed-out browser, and they count against the service's per-address limit.
  signOut: () => [queryKeys.session],
  setAbout: () => workspace,
  // A finished checklist ends the new install.
  completeSetupStep: () => [...workspace, queryKeys.session],
  updateDomain: () => workspace,
  addDomain: () => workspace,
  removeDomain: () => [...workspace, ...items],
  setOwner: () => workspace,
  setAdmin: () => workspace,
  invite: () => workspace,
  resendInvite: () => workspace,
  revokeInvite: () => workspace,
  removePerson: () => workspace,
  // Set in place (`inPlace`): opening an item changes nothing else the library holds.
  markViewed: () => [],
  editItem: () => items,
  restoreAsDraft: () => items,
  // A published item may answer a Not found card, and be the setup checklist's first item.
  saveItem: () => [...live, ...inbox, ...workspace, queryKeys.session, queryKeys.scopeSearches],
  // A draft saved from a Not found card is that card's draft.
  saveDraft: () => [...items, ...inbox],
  // Published or sent from the list or the Inbox's drafts card, drafts leave that card too.
  applyBulk: () => [...live, ...inbox, queryKeys.advancedPage],
  clearLeftDrafts: () => [queryKeys.advancedPage],
  // A new item sent waits for review in Context too, until it is decided or withdrawn.
  sendSuggestion: () => [...inbox, ...items, queryKeys.scopeSearches],
  withdrawSuggestion: () => [...inbox, ...items],
  undo: () => everything,
  // Settling archives an item, publishes a version or keeps both: the items, the Inbox's alert and
  // the comment that tells the other owners all move.
  settleConflict: () => [...live, ...inbox, ...comments, queryKeys.savedQuestions],
  suggestArchiving: () => inbox,
  postComment: () => comments,
  reactToComment: () => [queryKeys.comments],
  reactToSubject: () => [queryKeys.comments],
  editComment: () => comments,
  removeComment: () => comments,
  // The suggestion's review reads whether its sender took it back.
  withdrawWithComment: () => [...comments, queryKeys.reviews],
  resolveComment: () => [queryKeys.comments],
  markThreadSeen: () => [queryKeys.comments],
  markMentionSeen: () => comments,
  // What a family means is what Ask reads for it too.
  setFamilyMeaning: () => definitions,
  setFamilyUsual: () => definitions,
  // The items about a split family are due for a check, each with a card for its owners.
  splitFamily: () => [
    ...definitions,
    ...live,
    ...inbox,
    queryKeys.vocabulary,
    queryKeys.scopeSearches,
  ],
  joinFamily: () => [
    ...definitions,
    ...live,
    ...inbox,
    queryKeys.vocabulary,
    queryKeys.scopeSearches,
  ],
  saveTerm: () => definitions,
  addSynonym: () => definitions,
  removeTerm: () => definitions,
  deleteTerms: () => [...definitions, queryKeys.library, queryKeys.advancedPage],
  moveTerms: () => definitions,
  markOpened: () => inbox,
  markReviewed: () => inbox,
  decideCard: () => [...inbox, ...items],
  // The names card is open: its list comes with the answer (`inPlace`), and the rest waits (`later`).
  decideNames: () => inbox,
  completeCard: () => inbox,
  publishReview: () => decision,
  publishReviews: () => decision,
  archiveReview: () => decision,
  closeReview: () => decision,
  returnReview: () => [...decision, ...comments],
  saveQuestion: () => [queryKeys.savedQuestions],
  removeSavedQuestion: () => [queryKeys.savedQuestions],
  keepNewAnswer: () => [queryKeys.savedQuestions],
  checkSavedQuestions: () => [queryKeys.savedQuestions, queryKeys.savedCheck],
  setAlertRule: () => [queryKeys.alerts],
  saveView: () => [queryKeys.savedViews],
  saveChat: () => [queryKeys.chats],
  reportAnswer: () => [queryKeys.myReports, ...inbox],
  // Feedback counts the ratings.
  rateAnswer: () => [queryKeys.observabilityPages],
  takeBackRating: () => [queryKeys.observabilityPages],
  tellOwner: () => inbox,
  setTool: () => [queryKeys.settings, queryKeys.agentConnections, queryKeys.allDomainPolicies],
  setPause: () => [queryKeys.settings, queryKeys.advancedPage],
  setAutomaticRuns: () => [queryKeys.settings, queryKeys.advancedPage],
  // A new key is listed on Connected agents; the history log notes it.
  createAccessKey: () => [queryKeys.agentConnections, queryKeys.advancedPage],
  renameAccessKey: () => [queryKeys.agentConnections, queryKeys.advancedPage],
  // suggest_context off pauses the agent's policies.
  setAgentTool: () => [
    queryKeys.agentConnections,
    queryKeys.advancedPage,
    queryKeys.allDomainPolicies,
  ],
  // Checking and exporting change nothing.
  checkHistory: () => [],
  exportHistory: () => [],
  exportContext: () => [],
  setFigures: () => [queryKeys.settings, queryKeys.figures, queryKeys.integrations],
  setDataContact: () => [queryKeys.settings, queryKeys.figures, queryKeys.integrations],
  setFigureConnection: () => [queryKeys.settings, queryKeys.figures, queryKeys.integrations],
  // Connecting the definitions tool can be the setup checklist's last step.
  connectIntegration: () => [queryKeys.settings, ...integrations, ...workspace, queryKeys.session],
  changeIntegration: () => integrations,
  // A content tool's open suggestions leave the Inbox with it.
  disconnectIntegration: () => [queryKeys.settings, ...integrations, ...inbox],
  readIntegration: () => integrations,
  // A paused tool's figures are held in Ask, and back once it is resumed.
  pauseIntegration: () => [
    ...integrations,
    queryKeys.integrations,
    queryKeys.figures,
    queryKeys.advancedPage,
  ],
  // A revoked app's policies end with it.
  revokeAgent: () => [
    queryKeys.agentConnections,
    queryKeys.advancedPage,
    queryKeys.autoPublish,
    queryKeys.allDomainPolicies,
  ],
  // Publishing without review: Agents and access, the domain pages and the history log show it.
  setAutoPublish: () => [
    queryKeys.autoPublish,
    queryKeys.agentConnections,
    queryKeys.allDomainPolicies,
    queryKeys.advancedPage,
  ],
  setAgentPolicy: () => [
    queryKeys.autoPublish,
    queryKeys.agentConnections,
    queryKeys.allDomainPolicies,
    queryKeys.advancedPage,
  ],
  endAgentPolicy: () => [
    queryKeys.autoPublish,
    queryKeys.agentConnections,
    queryKeys.allDomainPolicies,
    queryKeys.advancedPage,
  ],
  // A yes adds a connected agent; the page then leaves for the agent.
  answerConnectRequest: () => [queryKeys.agentConnections],
  renameChat: () => [queryKeys.chats],
  deleteChat: () => [queryKeys.chats],
  removeView: () => [queryKeys.savedViews],
  pinDimensions: () => [queryKeys.obsDimensionLists, queryKeys.settings, queryKeys.advancedPage],
  muteAlert: () => [queryKeys.alerts],
  setAlertThreshold: () => [queryKeys.alerts],
}

/** Whether `key` starts with every part of `prefix`: invalidating the prefix refreshes it too. */
const startsWith = (key: QueryKey, prefix: QueryKey) =>
  prefix.length <= key.length &&
  prefix.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index]))

/**
 * The keys without those another key of the list covers, so each cache is fetched once: a second
 * invalidation of a cache in flight would cancel its read and send it again.
 */
export function coveringKeys(keys: readonly QueryKey[]): QueryKey[] {
  return keys.filter(
    (key, index) =>
      !keys.some(
        (other, at) =>
          at !== index && startsWith(key, other) && (other.length < key.length || at < index),
      ),
  )
}

/**
 * What a write changes that the app can say itself, set in its cache in place of reading the
 * whole cache again. Opening an item marks it opened; read again, the library is five requests.
 */
const inPlace: {
  [K in WriteOperation]?: (
    queryClient: QueryClient,
    input: WriteInput<K>,
    result: WriteResult<K>,
  ) => void
} = {
  markViewed: (queryClient, { id }) =>
    queryClient.setQueryData<Library>(queryKeys.library, (library) =>
      library && !library.viewed[id]
        ? { ...library, viewed: { ...library.viewed, [id]: true } }
        : library,
    ),
  // The answer holds the names that wait after the decision.
  decideNames: (queryClient, _input, { waiting }) =>
    queryClient.setQueryData(queryKeys.names, waiting),
}

/**
 * What a write makes stale that the screen it is made from does not show, marked stale without
 * a read: each is read again where it is shown next. An owner decides names one after another,
 * and every cache read again after each was a burst of calls the service's limit refused.
 */
const later: { [K in WriteOperation]?: QueryKey[] } = {
  // The names are the vocabulary's terms, a source's page counts them and the history log has
  // the decision. The checklist reads its step itself (pages/inbox.tsx). Every cache marked stale
  // would be read again by each row the card draws next.
  decideNames: [
    queryKeys.vocabulary,
    ...definitions,
    queryKeys.scopeSearches,
    ...integrations,
    queryKeys.advancedPage,
  ],
}

/**
 * Someone else now: a read still under way for the last person must not land in the new one's
 * cache, and what was read for them is not shown again. The sign-in page's own reads stay.
 */
async function forgetLastPerson(queryClient: QueryClient) {
  await queryClient.cancelQueries()
  queryClient.removeQueries({ type: 'inactive' })
}

/**
 * Another tab signed this browser in as someone else, and a change here was not sent as them:
 * the app moves to them as a sign-in does, so no screen keeps the last person's reads.
 */
export async function afterSomeoneElse(queryClient: QueryClient) {
  await forgetLastPerson(queryClient)
  await queryClient.refetchQueries({ queryKey: queryKeys.session })
  await queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
  })
}

/** Marks every cache a write made stale, so open screens fetch them again. */
export async function invalidateAfter<K extends WriteOperation>(
  queryClient: QueryClient,
  operation: K,
  input: WriteInput<K>,
  result: WriteResult<K>,
) {
  if (operation === 'signIn') await forgetLastPerson(queryClient)
  inPlace[operation]?.(queryClient, input, result)
  await Promise.all(
    (later[operation] ?? []).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, refetchType: 'none' }),
    ),
  )
  const keys = coveringKeys(invalidations[operation](input, result))
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/** Calls a write and refreshes what it made stale; its pending and failed states are the mutation's. */
export function useApiWrite<K extends WriteOperation>(operation: K) {
  const queryClient = useQueryClient()
  return useMutation<WriteResult<K>, Error, WriteInput<K>>({
    mutationKey: ['write', operation],
    mutationFn: (input) =>
      (api[operation] as (input: WriteInput<K>) => Promise<WriteResult<K>>)(input),
    onSuccess: (result, input) => invalidateAfter(queryClient, operation, input, result),
  })
}

/**
 * A write outside a mutation's own state, for a handler that does several in a row (an Undo, a
 * mark as read): it refreshes what each makes stale.
 */
export function useWrite() {
  const queryClient = useQueryClient()
  return async <K extends WriteOperation>(
    operation: K,
    input: WriteInput<K>,
    answered?: (result: WriteResult<K>) => void,
  ): Promise<WriteResult<K>> => {
    let result: WriteResult<K>
    try {
      result = await (api[operation] as (input: WriteInput<K>) => Promise<WriteResult<K>>)(input)
    } catch (error) {
      reportSignedOut(queryClient, error)
      if (
        (operation === 'setFamilyMeaning' || operation === 'setFamilyUsual') &&
        error instanceof ApiError &&
        error.kind === 'conflict'
      )
        await Promise.all(
          coveringKeys(invalidations[operation](input, undefined as WriteResult<K>)).map(
            (queryKey) => queryClient.invalidateQueries({ queryKey }),
          ),
        )
      throw error
    }
    answered?.(result)
    await invalidateAfter(queryClient, operation, input, result)
    return result
  }
}

/**
 * Refreshes what a write made stale, for a screen that called the binding itself and shows the
 * outcome first (rows that leave, then the list without them).
 */
export function useRefreshAfter() {
  const queryClient = useQueryClient()
  return <K extends WriteOperation>(operation: K, input: WriteInput<K>, result: WriteResult<K>) =>
    invalidateAfter(queryClient, operation, input, result)
}

/** The page reads (a screen's own load): what a review flag that sets a fault starts again. */
export const isPageQuery = (key: QueryKey) => typeof key[0] === 'string' && isPageRead(key[0])
