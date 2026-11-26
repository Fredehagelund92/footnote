import type { Catalogue } from '../../../contract/index.ts'
import type { ConflictList } from '../../../contract/conflicts.ts'
import type { ItemPage } from '../../../contract/context.ts'
import type { ProposalListResult, ProposalRecord } from '../../../contract/proposals.ts'
import type { Feed } from '../../../contract/inbox.ts'
import type { TermList, TermVersion } from '../../../contract/terms.ts'
import type { Calendar } from '../../../domain/dates.ts'
import type { RecordsItem } from '../../../domain/records.ts'
import { todayIn, type Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import type { ServingBundle } from '../editions/index.ts'
import type { ScopedIndex } from '../library/index.ts'
import { itemsOf, momentOf } from './records.ts'
import { askedFor, liveBundle, type BundleCache } from './service.ts'

/*
  What Ask's tools read (FR-718.1): the reads the person's own pages make, each inside the
  person's own request, so row security and the audience rule apply to every one, and the live
  edition the engine of find_context, get_context and read_context answers agents from. Each read
  is made at most once a turn, and none of them writes: Ask's tools change nothing (FR-718.4).
*/

/**
 * A context item not published yet that the person may open: their own draft, or a suggestion
 * waiting for review that they sent or decide for. Row security on proposals decides which.
 */
export type PendingItem = Pick<
  ProposalRecord,
  'id' | 'number' | 'state' | 'action' | 'areaId' | 'itemId' | 'title' | 'proposerId' | 'draft'
> & { submittedAt: string | null; createdAt: string }

/** The states of what is not published yet: a draft, and a suggestion waiting for review. */
const PENDING_STATES = ['draft', 'submitted', 'in_review'] as const

/** The most of them a turn reads: every one a person may open on any install we know of. */
const PENDING_READ = 500

/** A domain and its owners, by id. */
export type ToolArea = { id: string; name: string; ownerIds: readonly string[] }

/** The reads Ask's tools are made from, each as the person's request makes it. */
export type ToolReads = {
  /** What agents get now: the live edition. One bundle serves everyone. */
  bundle: () => Promise<ServingBundle>
  /** The Context list, as `library.index` reads it for the person, with each scope by key. */
  index: () => Promise<ScopedIndex>
  /** Which items the Context list gives the person, with each one's kind and status, read now. */
  readable: () => Promise<readonly { id: string; kind: string; status: string }[]>
  /** The Context list's items as the records keep them, with when each was published. */
  records: () => Promise<readonly RecordsItem[]>
  /**
   * The drafts and the suggestions waiting for review the person may open, of context items,
   * newest first. Only Ask reads them, never an agent (FR-718.5).
   */
  pending: () => Promise<readonly PendingItem[]>
  areas: () => Promise<readonly ToolArea[]>
  /** The workspace's people, as Context names owners. */
  people: () => Promise<readonly { id: string; name: string }[]>
  /** Definitions as the catalogue shows them to the person: one their groups may not see is not here. */
  catalogue: () => Promise<Catalogue>
  /** The words people wrote in Definitions. */
  glossary: () => Promise<TermList>
  /** An item's History, newest first, as its page shows it to the person; null when they may not read it. */
  itemHistory: (id: string) => Promise<ItemPage['history'] | null>
  /** A word written in Definitions, each version newest first, as its History shows it. */
  termHistory: (id: string) => Promise<readonly TermVersion[]>
  /** The conflicts, as Context's Conflicts filter lists them to the person. */
  conflicts: () => Promise<ConflictList>
  /** The person's own Inbox: what needs them. */
  inbox: () => Promise<Feed>
  /** What agents asked, as this reader may have it (FR-614), with the minimum count shown. */
  asked: () => ReturnType<typeof askedFor>
  /** The workspace's calendar (R8): its fiscal year start and the time zone of `today`. */
  calendar: Calendar
  /** Today in the workspace's time zone. */
  today: string
  /** The service's moment, for a period such as "this week". */
  now: string
}

/** A read made once, however often it is asked for. */
const once = <T>(read: () => Promise<T>) => {
  let made: Promise<T> | null = null
  return () => (made ??= read())
}

/**
 * The reads of one turn of Ask, kept across its transactions, by name: each of the turn's reads
 * (the code check, every tool the model calls, the chat's earlier reads made again) is a
 * transaction of its own, and all of them read the person's workspace as it was when the turn
 * first read it, made once. A read that fails is not kept: the next one reads again.
 */
export type TurnReads = {
  get(name: string): Promise<unknown> | undefined
  set(name: string, read: Promise<unknown>): void
  delete(name: string): void
}

/**
 * The reads a person's next turn may start from: only what the live edition governs, the words
 * written in Definitions, which a new live edition changes. Everything else is read again each
 * turn: the catalogue carries the items that mention a term, the open gaps and the library's
 * index, which a publish or a gap changes without a new live edition (FR-718.3).
 */
const BETWEEN_TURNS = new Set(['glossary'])

/**
 * A person's reads of their workspace, kept between their turns of Ask, so a follow-up does not
 * read the words written in Definitions again (Ask's speed budget, docs/releasing.md). They are
 * kept until the live edition changes, with no time limit. The rest of a turn's reads are its
 * own, made afresh: the catalogue, which items the person may read, the records, the domains and
 * their owners, the people, the Inbox and the conflicts.
 */
export function createKeptReads() {
  const kept = new Map<string, { edition: string; reads: Map<string, Promise<unknown>> }>()
  return {
    /** The reads of a turn of `person`'s, on the live edition `edition`. */
    turn(person: string, edition: string): TurnReads {
      let at = kept.get(person)
      if (!at || at.edition !== edition) {
        at = { edition, reads: new Map() }
        kept.set(person, at)
      }
      const between = at.reads
      const own = new Map<string, Promise<unknown>>()
      const of = (name: string) => (BETWEEN_TURNS.has(name) ? between : own)
      return {
        get: (name) => of(name).get(name),
        set: (name, read) => void of(name).set(name, read),
        delete: (name) => void of(name).delete(name),
      }
    },
  }
}
export type KeptReads = ReturnType<typeof createKeptReads>

/** A read kept for the turn in `kept` under `name`, made at most once while it is kept. */
const keptFor =
  (kept: TurnReads) =>
  <T>(name: string, read: () => Promise<T>) =>
  (): Promise<T> => {
    const before = kept.get(name)
    if (before) return before as Promise<T>
    const made = read()
    kept.set(name, made)
    made.catch(() => kept.delete(name))
    return made
  }

/**
 * Reads that run one after the other, whoever asks: a transaction runs one statement at a time,
 * and a loop may call two tools at once. A read here never waits on another read here.
 */
function inTurn() {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(read: () => Promise<T>): Promise<T> => {
    const next = last.then(read, read)
    last = next.catch(() => undefined)
    return next
  }
}

/** The services of the person's request the tools read through. */
export type ToolServices = {
  library: {
    getIndex(): Promise<ScopedIndex>
    getReadable(): Promise<{ id: string; kind: string; status: string }[]>
  }
  areas: { list(): Promise<{ id: string; name: string; ownerIds: string[] }[]> }
  catalogue: { list(): Promise<Catalogue> }
  terms: { list(): Promise<TermList>; history(id: string): Promise<TermVersion[]> }
  context: { page(id: string): Promise<ItemPage | null> }
  conflicts: { list(input: { whose: 'all' }): Promise<ConflictList> }
  cards: { feed(tab: 'needs'): Promise<Feed> }
  proposals: {
    list(input: {
      state: (typeof PENDING_STATES)[number]
      limit: number
      offset: number
    }): Promise<Pick<ProposalListResult, 'rows' | 'total'>>
  }
  people: () => Promise<readonly { id: string; name: string }[]>
}

/**
 * Ask's tool reads, inside the person's request transaction. With `kept`, the reads that do not
 * name an item are the turn's own, made once for all its transactions (`TurnReads`).
 */
export function toolReadsIn(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  services: ToolServices,
  calendar: Calendar,
  kept: TurnReads = new Map(),
): ToolReads {
  const turn = inTurn()
  const keep = keptFor(kept)
  const serial = <T>(name: string, read: () => Promise<T>) =>
    keep(
      name,
      once(() => turn(read)),
    )
  const index = serial('index', () => services.library.getIndex())
  const moment = momentOf(clock)
  return {
    bundle: serial('bundle', () => liveBundle(tx, cache)),
    index,
    readable: serial('readable', () => services.library.getReadable()),
    // The records wait for the index first, then take their turn: never a read inside a read.
    records: keep('records', async () => {
      const listed = await index()
      return turn(() => itemsOf(tx, listed, moment))
    }),
    pending: serial('pending', async () => {
      const rows: PendingItem[] = []
      for (const state of PENDING_STATES)
        for (let offset = 0; rows.length < PENDING_READ; offset += 100) {
          const page = await services.proposals.list({ state, limit: 100, offset })
          rows.push(...page.rows.filter((p) => p.subject === 'item'))
          if (offset + page.rows.length >= page.total || !page.rows.length) break
        }
      return rows.slice(0, PENDING_READ)
    }),
    areas: serial('areas', () => services.areas.list()),
    people: serial('people', () => services.people()),
    catalogue: serial('catalogue', () => services.catalogue.list()),
    glossary: serial('glossary', () => services.terms.list()),
    itemHistory: (id) => turn(async () => (await services.context.page(id))?.history ?? null),
    termHistory: (id) => turn(() => services.terms.history(id)),
    conflicts: serial('conflicts', () => services.conflicts.list({ whose: 'all' })),
    inbox: serial('inbox', () => services.cards.feed('needs')),
    asked: serial('asked', () => askedFor(tx, clock, cache)),
    calendar,
    today: todayIn(clock, calendar.timeZone),
    now: moment.now,
  }
}
