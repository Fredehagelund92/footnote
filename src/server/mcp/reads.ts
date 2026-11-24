import type { CatalogueTerm, DefinitionRelations } from '../../contract/catalogue.ts'
import type { Clock } from '../clock.ts'
import type { Database, Queryable } from '../db/database.ts'
import { createCatalogueService } from '../modules/catalogue/index.ts'
import { waitingMembers, type WaitingMember } from '../modules/review/index.ts'

/*
  What find_context and read_context read beside the served edition: the members of the definition
  sources a domain has that are no vocabulary term yet, and one live definition as Definitions shows
  it. The reads go through the service functions the API uses, so nothing here decides what a reader
  may see: the outcome tools then keep only what an agent may read of the live edition (FR-314).
*/

/** The members of the definition sources that domains have and the vocabulary does not yet. */
export type WaitingTerms = { members: WaitingMember[] }

/**
 * A live metric or dimension as Definitions shows it (FR-136, FR-142, FR-143): its catalogue
 * entry, a family's for one of its metrics, and what the metric is built from. Null when the
 * catalogue lists neither, as for a definition the source limits to groups (CON-509).
 */
export type DefinitionRead = {
  term: CatalogueTerm
  relations: DefinitionRelations['relations']
}

export interface ServingReads {
  /** The source members that are no vocabulary term yet, by domain. */
  waiting(): Promise<WaitingTerms>
  /** One live metric, family or dimension by its key, as Definitions shows it. */
  definition(key: string): Promise<DefinitionRead | null>
}

/** The reads in a transaction already open as a person or as nobody (an agent). */
function readsIn(tx: Queryable, clock: Clock): ServingReads {
  return {
    async waiting() {
      return { members: await waitingMembers(tx) }
    },
    async definition(key) {
      const catalogue = createCatalogueService(tx, clock)
      // One after the other: a transaction runs one statement at a time.
      const { terms } = await catalogue.list()
      const term = terms.find(
        (t) => t.key === key || (t.family?.variants.some((v) => v.key === key) ?? false),
      )
      if (!term) return null
      const built = key.startsWith('metric:') ? await catalogue.relations(key) : null
      return { term, relations: built?.relations ?? [] }
    },
  }
}

/** The reads for an agent over MCP, in a transaction of their own that names no person. */
export function createServingReads(database: Database, clock: Clock): ServingReads {
  return {
    waiting: () => database.transaction(null, (tx) => readsIn(tx, clock).waiting()),
    definition: (key) => database.transaction(null, (tx) => readsIn(tx, clock).definition(key)),
  }
}
