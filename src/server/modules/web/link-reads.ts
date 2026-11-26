import { ORPCError } from '@orpc/client'
import type { Database, Queryable } from '../../db/database.ts'
import { productName } from '../../brand.ts'
import { PageReadError, type PageRead, type PageReader, type ReadFailure } from './read.ts'

/*
  The one door to the page reader for a link a person pastes (FR-144): the workspace's switch,
  the hosts an admin listed never to read, and the limits, then the reader. A read is taken in a
  transaction of its own, committed before the page is asked for, so one that fails still counts
  and every service process counts the same reads. Every refusal is one sentence that ends by
  offering what always works: pasting the page's text.
*/

/** The link a person pasted, when the text is a link alone: then the page is what they mean. */
export function pastedLink(text: string): string | null {
  const trimmed = text.trim()
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null
}

/** Opens one link for the person, under the workspace's rules; rejects with an ORPCError. */
export type LinkReader = (address: string) => Promise<PageRead>

const paste = "Paste the page's text instead."

/** The reasons that would say something about the network behind an address: told as one. */
const unopened = new Set<ReadFailure>([
  'not_public',
  'unreachable',
  'timeout',
  'status',
  'redirects',
])

/** What the person reads when a link is not read, by the reason. */
export function linkRefusal(reason: ReadFailure | 'off'): string {
  switch (reason) {
    case 'off':
      return `Reading links is off in this workspace. ${paste}`
    case 'needs_sign_in':
      return `${productName} can't open that page: it needs a sign-in, and ${productName} never signs in as you. ${paste}`
    case 'has_key':
      return `That link carries a key or a sign-in code, so ${productName} doesn't open it or keep it. ${paste}`
    case 'credentials':
      return `That link holds a name and a password, so ${productName} doesn't open it. ${paste}`
    case 'blocked_host':
      return `An admin listed that site as one ${productName} never reads. ${paste}`
    case 'port':
      return `${productName} reads pages on the web's usual port only. ${paste}`
    case 'not_https':
      return `${productName} reads web pages only. ${paste}`
    case 'too_large':
      return `That page is over 2 MB, more than ${productName} reads. ${paste}`
    case 'pdf':
      return `${productName} doesn't read PDFs yet. ${paste}`
    case 'not_text':
      return `That link is a file, not a web page. ${paste}`
    // Nothing about the network behind an address reaches the person.
    case 'not_public':
    case 'unreachable':
    case 'timeout':
    case 'status':
    case 'redirects':
      return `${productName} couldn't open that page. ${paste}`
  }
}

/** A wait in words: "12 minutes", "3 hours". */
const waitWords = (seconds: number) => {
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`
  const hours = Math.ceil(minutes / 60)
  return hours === 1 ? '1 hour' : `${hours} hours`
}

const limitSentence = (refused: string, reads: number, wait: number) => {
  const again = `Try again in ${waitWords(wait)}, or paste the page's text instead.`
  return refused === 'person_hour'
    ? `You've read ${reads} links in the last hour. ${again}`
    : refused === 'person_day'
      ? `You've read ${reads} links in the last 24 hours. ${again}`
      : `This workspace has read ${reads} links in the last 24 hours, the most it may. ${again}`
}

/** The workspace's answer to one more read: off, over a limit, or taken, with the hosts never read. */
type Taken =
  { off: true } | { limit: string; reads: number; wait: number } | { blockedHosts: string[] }

type LinkSettings = { on: boolean; blockedHosts: string[] }

async function linkSettings(tx: Queryable): Promise<LinkSettings> {
  const rows = await tx.query<{ key: string; value: unknown }>(
    `select key, value from settings_current
      where key in ('links.read_pages', 'links.never_read_hosts')`,
  )
  const value = (key: string) => rows.find((row) => row.key === key)?.value
  const hosts = value('links.never_read_hosts')
  return {
    // A workspace whose setting is missing reads links, as installed.
    on: value('links.read_pages') !== false,
    blockedHosts: Array.isArray(hosts) ? hosts.filter((h) => typeof h === 'string') : [],
  }
}

/** The person's link reader: the switch, the limits and the listed hosts, then the page. */
export function linkReaderFor(
  database: Database,
  readPage: PageReader,
  personId: string,
): LinkReader {
  return async (address) => {
    const taken = await database.transaction(personId, async (tx): Promise<Taken> => {
      const settings = await linkSettings(tx)
      if (!settings.on) return { off: true }
      const [take] = await tx.query<{
        refused: string | null
        reads: number | null
        wait_seconds: number | null
      }>('select refused, reads, wait_seconds from cl_link_read_take()')
      if (take?.refused)
        return { limit: take.refused, reads: take.reads ?? 0, wait: take.wait_seconds ?? 60 }
      return { blockedHosts: settings.blockedHosts }
    })
    if ('off' in taken)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: linkRefusal('off'),
        data: { reason: 'off' },
      })
    if ('limit' in taken)
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: limitSentence(taken.limit, taken.reads, taken.wait),
        data: { retryAfterSeconds: taken.wait },
      })
    try {
      return await readPage(address, { blockedHosts: taken.blockedHosts })
    } catch (error) {
      const reason = error instanceof PageReadError ? error.reason : 'unreachable'
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: linkRefusal(reason),
        data: { reason: unopened.has(reason) ? 'unreadable' : reason },
      })
    }
  }
}
