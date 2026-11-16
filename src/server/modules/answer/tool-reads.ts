import type { Catalogue } from '../../../contract/index.ts'
import type { ConflictList } from '../../../contract/conflicts.ts'
import type { ItemPage } from '../../../contract/context.ts'
import type { Feed } from '../../../contract/inbox.ts'
import type { TermList, TermVersion } from '../../../contract/terms.ts'
import type { RecordsItem } from '../../../domain/records.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import type { ServingBundle } from '../editions/index.ts'
import type { ScopedIndex } from '../library/index.ts'
import { itemsOf, momentOf, type RecordsReads } from './records.ts'
import { askedFor, liveBundle, type BundleCache } from './service.ts'

/*
  What Ask's tools read (FR-718.1): the reads the person's own pages make, each inside the
  person's own request, so row security and the audience rule apply to every one, and the live
  edition the engine of find_context, get_context and read_context answers agents from. Each read
  is made at most once a turn, and none of them writes: Ask's tools change nothing (FR-718.4).
*/

/** A domain and its owners, by id. */
export type ToolArea = { id: string; name: string; ownerIds: readonly string[] }

/** The reads Ask's tools are made from, each as the person's request makes it. */
export type ToolReads = {
  /** What agents get now: the live edition. One bundle serves everyone. */
  bundle: () => Promise<ServingBundle>
  /** The Context list, as `library.index` reads it for the person, with each scope by key. */
  index: () => Promise<ScopedIndex>
  /** The Context list's items as the records keep them, with when each was published. */
  records: () => Promise<readonly RecordsItem[]>
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
  /** What agents asked, as this reader may have it (FR-614). */
  asked: RecordsReads['asked']
  /** The service's UTC day. */
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
  library: { getIndex(): Promise<ScopedIndex> }
  areas: { list(): Promise<{ id: string; name: string; ownerIds: string[] }[]> }
  catalogue: { list(): Promise<Catalogue> }
  terms: { list(): Promise<TermList>; history(id: string): Promise<TermVersion[]> }
  context: { page(id: string): Promise<ItemPage | null> }
  conflicts: { list(input: { whose: 'all' }): Promise<ConflictList> }
  cards: { feed(tab: 'needs'): Promise<Feed> }
  people: () => Promise<readonly { id: string; name: string }[]>
}

/** Ask's tool reads, inside the person's request transaction. */
export function toolReadsIn(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
  services: ToolServices,
): ToolReads {
  const turn = inTurn()
  const serial = <T>(read: () => Promise<T>) => once(() => turn(read))
  const index = serial(() => services.library.getIndex())
  const moment = momentOf(clock)
  return {
    bundle: serial(() => liveBundle(tx, cache)),
    index,
    // The records wait for the index first, then take their turn: never a read inside a read.
    records: once(async () => {
      const listed = await index()
      return turn(() => itemsOf(tx, listed, moment))
    }),
    areas: serial(() => services.areas.list()),
    people: serial(() => services.people()),
    catalogue: serial(() => services.catalogue.list()),
    glossary: serial(() => services.terms.list()),
    itemHistory: (id) => turn(async () => (await services.context.page(id))?.history ?? null),
    termHistory: (id) => turn(() => services.terms.history(id)),
    conflicts: serial(() => services.conflicts.list({ whose: 'all' })),
    inbox: serial(() => services.cards.feed('needs')),
    asked: serial(() => askedFor(tx, clock, cache)),
    today: clock.today(),
    now: moment.now,
  }
}
