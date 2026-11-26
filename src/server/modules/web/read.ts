import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'
import { textFindings } from '../../../domain/draft.ts'
import { isPublicAddress, publicLookup } from '../oauth/index.ts'
import { decodePage, pageText, charsetOf } from './page-text.ts'

/*
  Footnote opens a web page a person linked, to draft context from it (the editor's draft from text).
  It is the service reaching out to an address someone else chose, so it reaches only the public web
  (FR-144): https on port 443 only; a name resolved here with every answer public and the
  connection made to that answer, so a second lookup cannot point it inside the network (DNS
  rebinding); no credentials and no key in the address, so a signed or one-time link is never
  opened, used up or kept; none of the hosts an admin listed, nor their subdomains; every redirect
  checked again, at most five; at most 2 MB, decompressed, within 15 seconds; text pages only, and
  never a sign-in page. It connects directly, never through an outbound proxy, so the checked
  answer is the one it reaches; it sends no cookie and no authorisation. At most four reads at
  once, one per host, so a slow site cannot tie up the service. Every failure is one plain reason,
  so nothing about the network behind an address reaches the person. The page is kept in memory
  for the call and never stored (FR-116).
*/

export const readFailures = [
  'not_https',
  'port',
  'credentials',
  'has_key',
  'blocked_host',
  'not_public',
  'unreachable',
  'timeout',
  'too_large',
  'status',
  'pdf',
  'not_text',
  'redirects',
  'needs_sign_in',
] as const
export type ReadFailure = (typeof readFailures)[number]

export class PageReadError extends Error {
  override name = 'PageReadError'
  readonly reason: ReadFailure
  /** The status the page answered with, for `status`. */
  readonly status: number | undefined
  constructor(reason: ReadFailure, status?: number) {
    super(reason)
    this.reason = reason
    this.status = status
  }
}

/** A page as Footnote read it: where it ended up, its title and its paragraphs. */
export type PageRead = {
  /** The address asked for. */
  url: string
  /** The address that answered, after any redirects. */
  finalUrl: string
  contentType: string
  charset: string
  /** The page's size as read, decompressed. */
  bytes: number
  title: string | null
  paragraphs: string[]
}

export type PageReaderOptions = {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /**
   * Also reads plain http on this machine (127.0.0.1, ::1, localhost): the tests and the
   * end-to-end suite serve their pages there. Never another private address. Refused in
   * production by the configuration (FOOTNOTE_WEB_READ_LOOPBACK).
   */
  loopback?: boolean
  /** The most reads at once, and at once on one host. Four and one. */
  concurrency?: { total: number; perHost: number }
}

export type ReadOptions = {
  signal?: AbortSignal | undefined
  /** Hosts an admin listed never to be read (`links.never_read_hosts`); each covers its subdomains. */
  blockedHosts?: readonly string[] | undefined
}

/** Opens one address; rejects with a PageReadError. */
export type PageReader = (address: string, options?: ReadOptions) => Promise<PageRead>

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const CONCURRENCY = { total: 4, perHost: 1 }

/** Said plainly to every site Footnote reads, so its owner can tell what reads it. */
const headers = {
  // eslint-disable-next-line brand/no-product-name -- the user agent sites see, a technical name (docs/product-name.md)
  'user-agent': 'Mozilla/5.0 (compatible; Footnote/1.0; reads a page a person linked)',
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
  'accept-language': 'en;q=0.9, pt;q=0.8, es;q=0.8, *;q=0.5',
  'accept-encoding': 'gzip, deflate, br',
}

const loopbackAddress = (address: string) =>
  /^127\./.test(address) || address === '::1' || /^::ffff:127\./i.test(address)

/** Resolves a name for the tests' loopback mode: every answer public or on this machine. */
const loopbackLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0)
    if (
      !addresses.length ||
      addresses.some((a) => !isPublicAddress(a.address) && !loopbackAddress(a.address))
    )
      return callback(
        Object.assign(new Error('The address is not public'), { code: 'ENOTPUBLIC' }),
        '',
        0,
      )
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses)
    return callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}

/**
 * Words a query parameter is named with when it carries a key, a signature or a sign-in: a part
 * of its name (access_token, apiKey, X-Amz-Signature). `code` and `sig` count only as the whole
 * name, as country_code and zip_code are common and harmless.
 */
const keyWords = new Set([
  'apikey',
  'auth',
  'authorization',
  'credential',
  'credentials',
  'jwt',
  'key',
  'otp',
  'passwd',
  'password',
  'secret',
  'session',
  'sessionid',
  'signature',
  'token',
])
const keyNames = new Set(['code', 'sig'])

/** Whether a query parameter's name is a key's, a signature's or a sign-in's. */
export function isKeyParameter(name: string): boolean {
  const lower = name.toLowerCase()
  if (/^x-(?:amz|goog)-/.test(lower) || keyNames.has(lower)) return true
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((part) => keyWords.has(part))
}

/** Whether an address carries a key: a parameter named like one, or what FR-117 refuses in text. */
function carriesKey(url: URL): boolean {
  if ([...url.searchParams.keys()].some(isKeyParameter)) return true
  let words = url.href
  try {
    words = decodeURIComponent(url.href)
  } catch {
    // An address that does not decode is checked as it is written.
  }
  return textFindings(words).length > 0
}

/** A host in Footnote's form of it: lower case, no brackets, no final dot. */
const hostOf = (url: URL) =>
  url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()

/** An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, or its hex form) as the IPv4 address it reaches. */
function unmapped(host: string): string {
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  if (hex) {
    const [high, low] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)]
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  return host.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
}

/** Whether an admin listed the host, or a name it is under. */
const listed = (host: string, blockedHosts: readonly string[]) => {
  const name = unmapped(host)
  return blockedHosts.some((entry) => {
    const listedName = unmapped(entry)
    return name === listedName || name.endsWith(`.${listedName}`)
  })
}

/**
 * An address Footnote may open, as a URL without its fragment, or the reason it may not. Plain http
 * is read as https: the same page, over the only protocol and port Footnote uses.
 */
export function readableAddress(
  address: string,
  loopback = false,
  blockedHosts: readonly string[] = [],
): URL | ReadFailure {
  const url = URL.parse(address.trim())
  if (!url) return 'not_https'
  url.hash = ''
  if (url.username || url.password) return 'credentials'
  if (carriesKey(url)) return 'has_key'
  const host = hostOf(url)
  if (listed(host, blockedHosts)) return 'blocked_host'
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    (isIP(host) !== 0 && loopbackAddress(host))
  if (local) return loopback && /^https?:$/.test(url.protocol) ? url : 'not_public'
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') return 'not_https'
  // An empty port is 443: the URL drops a scheme's own port.
  if (url.port !== '') return 'port'
  if (isIP(host) !== 0 && !isPublicAddress(host)) return 'not_public'
  return url
}

/**
 * Whether a page is a sign-in page: it asks for a password, or, when the link led to another
 * host, it holds a form that signs in. Footnote never signs in, so such a page is never the
 * content the person linked.
 */
function isSignIn(html: string, otherHost: boolean): boolean {
  // Every scan is bounded: the page is someone else's, up to 2 MB, and may be made to be slow.
  if (/<input\b[^<>]{0,1000}?\btype\s*=\s*["']?password\b/i.test(html)) return true
  if (!otherHost) return false
  const lower = html.toLowerCase()
  for (let at = lower.indexOf('<form'), forms = 0; at !== -1 && forms < 20; forms++) {
    const end = lower.indexOf('</form', at)
    const form = html.slice(at, Math.min(end === -1 ? html.length : end, at + 20_000))
    if (
      /\b(?:sign|log)[\s-]?(?:in|on)\b|\blogin\b|\bsso\b/i.test(
        form.replace(/<[^<>]{0,1000}>/g, ' '),
      ) ||
      /\baction\s*=\s*["'][^"'<>]{0,500}?(?:login|signin|sign-in|sso|oauth|authorize)/i.test(form)
    )
      return true
    at = lower.indexOf('<form', at + 5)
  }
  return false
}

/**
 * A lookup that also refuses the addresses an admin listed (`links.never_read_hosts`), so a name
 * that leads to a listed address is never read, whatever the name.
 */
function withoutListed(lookup: LookupFunction, blockedHosts: readonly string[]): LookupFunction {
  const listedAddresses = new Set(blockedHosts.filter((host) => isIP(host) !== 0).map(unmapped))
  if (!listedAddresses.size) return lookup
  return (hostname, options, callback) =>
    lookup(hostname, options, (error, address, family) => {
      const answers = Array.isArray(address) ? address.map((a) => a.address) : [address]
      if (!error && answers.some((a) => listedAddresses.has(unmapped(a))))
        return callback(
          Object.assign(new Error('The address is listed'), { code: 'ELISTED' }),
          '',
          0,
        )
      return (callback as (e: unknown, a: unknown, f?: number) => void)(error, address, family)
    })
}

/**
 * Lets at most `total` reads run at once, and `perHost` on one host; the rest wait their turn, or
 * until their read's time is up.
 */
function createGate({ total, perHost }: { total: number; perHost: number }) {
  let running = 0
  const hosts = new Map<string, number>()
  const waiting: { host: string; go: () => void }[] = []
  const free = (host: string) => running < total && (hosts.get(host) ?? 0) < perHost
  const take = (host: string) => {
    running++
    hosts.set(host, (hosts.get(host) ?? 0) + 1)
  }
  const release = (host: string) => {
    running--
    const left = (hosts.get(host) ?? 1) - 1
    if (left) hosts.set(host, left)
    else hosts.delete(host)
    for (let i = 0; i < waiting.length;) {
      const next = waiting[i]!
      if (!free(next.host)) i++
      else {
        waiting.splice(i, 1)
        take(next.host)
        next.go()
      }
    }
  }
  return (host: string, signal: AbortSignal) =>
    new Promise<() => void>((resolve, reject) => {
      if (signal.aborted) return reject(new PageReadError('timeout'))
      if (free(host)) {
        take(host)
        return resolve(() => release(host))
      }
      const entry = {
        host,
        go: () => {
          signal.removeEventListener('abort', abort)
          resolve(() => release(host))
        },
      }
      const abort = () => {
        waiting.splice(waiting.indexOf(entry), 1)
        reject(new PageReadError('timeout'))
      }
      signal.addEventListener('abort', abort, { once: true })
      waiting.push(entry)
    })
}

function send(url: URL, lookup: LookupFunction, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const call = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      { method: 'GET', headers, lookup, agent: false, signal },
      resolve,
    )
    call.on('error', reject)
    call.end()
  })
}

/** The response body as read, decompressed, refused past `max` bytes. */
async function body(response: IncomingMessage, max: number): Promise<Uint8Array> {
  const encoding = (response.headers['content-encoding'] ?? '').trim().toLowerCase()
  const stream: Readable =
    encoding === 'gzip' || encoding === 'x-gzip'
      ? response.pipe(createGunzip())
      : encoding === 'deflate'
        ? response.pipe(createInflate())
        : encoding === 'br'
          ? response.pipe(createBrotliDecompress())
          : response
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > max) {
      response.destroy()
      throw new PageReadError('too_large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const failureOf = (error: unknown, signal: AbortSignal): PageReadError => {
  if (error instanceof PageReadError) return error
  if (signal.aborted) return new PageReadError('timeout')
  const code = (error as { code?: unknown } | null)?.code
  return new PageReadError(
    code === 'ENOTPUBLIC' ? 'not_public' : code === 'ELISTED' ? 'blocked_host' : 'unreachable',
  )
}

export function createPageReader(options: PageReaderOptions = {}): PageReader {
  const max = options.maxBytes ?? MAX_BYTES
  const loopback = options.loopback ?? false
  const lookup = loopback ? loopbackLookup : publicLookup
  const gate = createGate(options.concurrency ?? CONCURRENCY)
  return async (address, { signal: outer, blockedHosts = [] } = {}) => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      ...(outer ? [outer] : []),
    ])
    const first = readableAddress(address, loopback, blockedHosts)
    if (typeof first === 'string') throw new PageReadError(first)
    let url = first
    const asked = url.href
    const guarded = withoutListed(lookup, blockedHosts)
    let release: (() => void) | undefined
    try {
      release = await gate(hostOf(first), signal)
      for (let hops = 0; ; hops++) {
        const response = await send(url, guarded, signal)
        const status = response.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume()
          if (hops >= (options.maxRedirects ?? MAX_REDIRECTS)) throw new PageReadError('redirects')
          const next: URL | ReadFailure = URL.canParse(response.headers.location, url)
            ? readableAddress(new URL(response.headers.location, url).href, loopback, blockedHosts)
            : 'not_https'
          if (typeof next === 'string') throw new PageReadError(next)
          url = next
          continue
        }
        if (status === 401 || status === 403) {
          response.resume()
          throw new PageReadError('needs_sign_in', status)
        }
        if (status !== 200) {
          response.resume()
          throw new PageReadError('status', status)
        }
        const contentType = (response.headers['content-type'] ?? '').toLowerCase()
        if (/^application\/pdf\b/.test(contentType)) {
          response.resume()
          throw new PageReadError('pdf')
        }
        const declared = /^(?:text\/html|application\/xhtml\+xml)\b/.test(contentType)
          ? 'html'
          : /^text\/plain\b/.test(contentType)
            ? 'text'
            : contentType
              ? null
              : 'sniff'
        if (!declared) {
          response.resume()
          throw new PageReadError('not_text')
        }
        const bytes = await body(response, max)
        const text = decodePage(bytes, contentType)
        const kind = declared === 'sniff' ? (/^\s*</.test(text) ? 'html' : 'text') : declared
        if (kind === 'html' && isSignIn(text, hostOf(url) !== hostOf(first)))
          throw new PageReadError('needs_sign_in')
        return {
          url: asked,
          finalUrl: url.href,
          contentType: contentType.split(';')[0]!.trim() || 'unknown',
          charset: charsetOf(bytes, contentType),
          bytes: bytes.length,
          ...pageText(text, kind),
        }
      }
    } catch (error) {
      throw failureOf(error, signal)
    } finally {
      release?.()
    }
  }
}
