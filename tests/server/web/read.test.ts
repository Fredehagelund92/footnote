import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPageReader,
  PageReadError,
  readableAddress,
  type ReadFailure,
} from '../../../src/server/modules/web/index.ts'

/*
  The page reader against a fake web server on this machine. The tests' reader may open http on
  loopback (as FOOTNOTE_WEB_READ_LOOPBACK lets the end-to-end suite); every other address rule
  holds: a redirect to a private, metadata or other-port address is refused at its hop, and so are
  a page too large (also once decompressed), one too slow, a PDF, a file that is not text, an error
  page and a sign-in page. A link that carries a key, or is on a listed host, is refused before any
  request. The service's own reader refuses this machine outright (FR-144).
*/

const latin1Page = Buffer.from(
  '<html><head><title>Regras de devolução</title></head><body><p>Art. 1º&nbsp;Ficam os comerciantes obrigados a aceitar a devolução.</p></body></html>',
  'latin1',
)

let server: Server
let base = ''
let other = ''
const hits: string[] = []
const cookies: (string | undefined)[] = []
let open = 0
let mostOpen = 0

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/'
    hits.push(path)
    if (path.startsWith('/held')) {
      // Answers after a while, counting how many reads are open at once.
      open++
      mostOpen = Math.max(mostOpen, open)
      return void setTimeout(() => {
        open--
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('Held a while.')
      }, 120)
    }
    const send = (status: number, headers: Record<string, string>, body: string | Buffer = '') => {
      response.writeHead(status, headers)
      response.end(body)
    }
    switch (path.split('?')[0]) {
      case '/page':
        return send(
          200,
          { 'content-type': 'text/html; charset=utf-8' },
          '<title>A page</title><p>Online sales to Spain stopped on 2 September 2026.</p>',
        )
      case '/returns-rules':
        return send(200, { 'content-type': 'text/html' }, latin1Page)
      case '/gzip':
        return send(
          200,
          { 'content-type': 'text/html', 'content-encoding': 'gzip' },
          gzipSync('<p>Packed words.</p>'),
        )
      case '/redirect':
        return send(302, { location: '/page' })
      case '/loop':
        return send(302, { location: '/loop' })
      case '/to-private':
        return send(302, { location: 'http://10.0.0.1/admin' })
      case '/to-metadata':
        return send(301, { location: 'https://169.254.169.254/latest/meta-data/' })
      case '/to-ftp':
        return send(302, { location: 'ftp://files.example.com/x' })
      case '/big':
        return send(200, { 'content-type': 'text/plain' }, Buffer.alloc(3 * 1024 * 1024, 97))
      case '/bomb':
        return send(
          200,
          { 'content-type': 'text/html', 'content-encoding': 'gzip' },
          gzipSync(Buffer.alloc(8 * 1024 * 1024, 32)),
        )
      case '/slow':
        return // never answers
      case '/pdf':
        return send(200, { 'content-type': 'application/pdf' }, '%PDF-1.7')
      case '/image':
        return send(200, { 'content-type': 'image/png' }, 'png')
      case '/missing':
        return send(404, { 'content-type': 'text/html' }, 'Not here')
      case '/no-type':
        return send(200, {}, '<p>No type, still a page.</p>')
      case '/to-port':
        return send(302, { location: 'https://example.com:8443/admin' })
      case '/401':
        return send(401, { 'content-type': 'text/html' }, '<p>Sign in first.</p>')
      case '/403':
        return send(403, { 'content-type': 'text/html' }, '<p>Not for you.</p>')
      case '/login':
        return send(
          200,
          { 'content-type': 'text/html' },
          '<title>Sign in</title><form method="post"><p>Sign in to continue.</p><label>Email <input name="email"></label><label>Password <input type="password" name="pw"></label><button>Sign in</button></form>',
        )
      case '/private':
        return send(302, { location: '/login' })
      case '/to-sso':
        // Another host (localhost, where the link named 127.0.0.1) that answers with a sign-in form.
        return send(302, { location: `${other}/sso` })
      case '/sso':
        return send(
          200,
          { 'content-type': 'text/html' },
          '<title>Acme</title><form action="/continue"><p>Sign in with your company account</p><input name="email"><button>Continue</button></form>',
        )
      case '/with-search':
        // The same host, a page whose header has a sign-in link and a search form: read.
        return send(
          200,
          { 'content-type': 'text/html' },
          '<title>Notice</title><a href="/login">Sign in</a><form action="/search"><input name="q"></form><p>Returns are counted on the day of the refund.</p>',
        )
      case '/unclosed':
        // Tags that never close, nearly 2 MB of them: made to make a careless pattern slow.
        return send(200, { 'content-type': 'text/html' }, '<input <form a '.repeat(120_000))
      case '/to-unclosed':
        return send(302, { location: `${other}/unclosed` })
      case '/cookie':
        response.writeHead(302, { location: '/echo', 'set-cookie': 'session=secret; Path=/' })
        return response.end()
      case '/echo':
        cookies.push(request.headers.cookie)
        return send(200, { 'content-type': 'text/plain' }, 'Echo.')
      default:
        return send(500, {}, '')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  other = base.replace('127.0.0.1', 'localhost')
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

const read = createPageReader({ loopback: true, timeoutMs: 1500, maxBytes: 2 * 1024 * 1024 })

async function refusal(promise: Promise<unknown>): Promise<ReadFailure> {
  try {
    await promise
  } catch (error) {
    if (error instanceof PageReadError) return error.reason
    throw error
  }
  throw new Error('The page was read')
}

describe('reading a page', () => {
  it('reads its title and paragraphs', async () => {
    const page = await read(`${base}/page`)
    expect(page).toMatchObject({
      url: `${base}/page`,
      finalUrl: `${base}/page`,
      contentType: 'text/html',
      charset: 'utf-8',
      title: 'A page',
      paragraphs: ['Online sales to Spain stopped on 2 September 2026.'],
    })
  })

  it('reads a Windows-1252 page that names no set, as some official sites serve their rules', async () => {
    const page = await read(`${base}/returns-rules`)
    expect(page.charset).toBe('windows-1252')
    expect(page.paragraphs).toEqual([
      'Art. 1º Ficam os comerciantes obrigados a aceitar a devolução.',
    ])
  })

  it('reads a compressed page, and a page that names no type when it is markup', async () => {
    expect((await read(`${base}/gzip`)).paragraphs).toEqual(['Packed words.'])
    expect((await read(`${base}/no-type`)).paragraphs).toEqual(['No type, still a page.'])
  })

  it('follows a redirect and says where the page answered', async () => {
    const page = await read(`${base}/redirect#part`)
    expect(page.url).toBe(`${base}/redirect`)
    expect(page.finalUrl).toBe(`${base}/page`)
  })
})

describe('what it refuses', () => {
  it('refuses a redirect to a private or metadata address at that hop, before any request', async () => {
    const before = hits.length
    expect(await refusal(read(`${base}/to-private`))).toBe('not_public')
    expect(await refusal(read(`${base}/to-metadata`))).toBe('not_public')
    expect(await refusal(read(`${base}/to-ftp`))).toBe('not_https')
    // Only the fake server was asked: the redirect's target never was.
    expect(hits.slice(before)).toEqual(['/to-private', '/to-metadata', '/to-ftp'])
  })

  it('stops after five redirects', async () => {
    expect(await refusal(read(`${base}/loop`))).toBe('redirects')
  })

  it('refuses a page over 2 MB, also when it only grows that large decompressed', async () => {
    expect(await refusal(read(`${base}/big`))).toBe('too_large')
    expect(await refusal(read(`${base}/bomb`))).toBe('too_large')
  })

  it('gives up on a site that does not answer in time', async () => {
    expect(await refusal(read(`${base}/slow`))).toBe('timeout')
  })

  it('refuses a PDF, a file that is not text and an error page', async () => {
    expect(await refusal(read(`${base}/pdf`))).toBe('pdf')
    expect(await refusal(read(`${base}/image`))).toBe('not_text')
    await expect(read(`${base}/missing`)).rejects.toMatchObject({ reason: 'status', status: 404 })
  })

  it('refuses a redirect to another port at that hop, before any request', async () => {
    const before = hits.length
    expect(await refusal(read(`${base}/to-port`))).toBe('port')
    expect(hits.slice(before)).toEqual(['/to-port'])
  })

  it('refuses a page that needs a sign-in: 401, 403, a password field, or a sign-in form elsewhere', async () => {
    for (const path of ['/401', '/403', '/login', '/private', '/to-sso'])
      expect(await refusal(read(`${base}${path}`)), path).toBe('needs_sign_in')
    // A page's own sign-in link and search form are not a sign-in page.
    expect((await read(`${base}/with-search`)).paragraphs).toContain(
      'Returns are counted on the day of the refund.',
    )
  })

  it('refuses a link that carries a key before any request, and keeps no part of it', async () => {
    const before = hits.length
    for (const query of [
      '?token=abc123',
      '?sig=abc',
      '?X-Amz-Signature=abc&X-Amz-Credential=x',
      '?X-Goog-Signature=abc',
      '?access_token=abc',
      '?apiKey=abc',
      '?code=abc',
      '?session_id=abc',
      '?password=hunter2',
      '?to=jane.doe@example.com',
    ])
      expect(await refusal(read(`${base}/page${query}`)), query).toBe('has_key')
    expect(hits.slice(before)).toEqual([])
    // Parameters that only look alike are read.
    expect((await read(`${base}/page?country_code=no&keyword=returns`)).title).toBe('A page')
  })

  it('never requests a host an admin listed, nor its subdomains, also after a redirect', async () => {
    const before = hits.length
    const listed = { blockedHosts: ['localhost'] }
    expect(await refusal(read(`${other}/page`, listed))).toBe('blocked_host')
    expect(
      await refusal(read(other.replace('localhost', 'pages.localhost') + '/page', listed)),
    ).toBe('blocked_host')
    expect(hits.slice(before)).toEqual([])
    expect(await refusal(read(`${base}/to-sso`, listed))).toBe('blocked_host')
    expect(hits.slice(before)).toEqual(['/to-sso'])
  })

  it('looks for a sign-in form in bounded time, on a page made to be slow', async () => {
    const started = performance.now()
    await read(`${base}/unclosed`)
    await read(`${base}/to-unclosed`)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('sends no cookie a redirect set', async () => {
    await read(`${base}/cookie`)
    expect(cookies).toEqual([undefined])
  })

  it('reads one page at a time on a host, and at most four at once', async () => {
    mostOpen = 0
    await Promise.all(Array.from({ length: 3 }, (_, i) => read(`${base}/held${i}`)))
    expect(mostOpen).toBe(1)
    mostOpen = 0
    const wide = createPageReader({ loopback: true, concurrency: { total: 2, perHost: 5 } })
    await Promise.all(Array.from({ length: 5 }, (_, i) => wide(`${base}/held-wide${i}`)))
    expect(mostOpen).toBe(2)
  })

  it('gives up on a read that waits for its turn past its time', async () => {
    const slow = createPageReader({ loopback: true, timeoutMs: 200 })
    const first = refusal(slow(`${base}/slow`))
    expect(await refusal(slow(`${base}/page`))).toBe('timeout')
    expect(await first).toBe('timeout')
  })

  it("refuses this machine with the service's own reader", async () => {
    const service = createPageReader()
    expect(await refusal(service(`${base}/page`))).toBe('not_public')
    expect(await refusal(service(base.replace('127.0.0.1', 'localhost') + '/page'))).toBe(
      'not_public',
    )
    expect(hits.filter((hit) => hit === '/page')).toHaveLength(2)
  })
})

describe('the addresses Footnote may open', () => {
  const rule = (address: string, loopback = false, blockedHosts: string[] = []) => {
    const result = readableAddress(address, loopback, blockedHosts)
    return typeof result === 'string' ? result : result.href
  }

  it('opens https on public hosts, reads plain http as https and drops the fragment', () => {
    expect(rule('https://consumer.example/eu/right-of-withdrawal#art1')).toBe(
      'https://consumer.example/eu/right-of-withdrawal',
    )
    expect(rule('http://www.example.gov/acts?x=1')).toBe('https://www.example.gov/acts?x=1')
  })

  it('opens port 443 only: another port is refused before any lookup, plain http on 8080 too', () => {
    for (const address of [
      'https://example.com:22/',
      'https://example.com:6379/',
      'https://example.com:8443/',
      'http://example.com:8080/',
      'http://example.com:80/x',
    ])
      expect(rule(address), address).toBe(
        address.endsWith(':80/x') ? 'https://example.com/x' : 'port',
      )
    expect(rule('https://example.com:443/x')).toBe('https://example.com/x')
  })

  it('refuses IPv4-compatible IPv6 and the newer special ranges', () => {
    for (const address of [
      'https://[::10.0.0.1]/',
      'https://[::a9fe:a9fe]/',
      'https://[::7f00:1]/',
      'https://[3fff::1]/',
      'https://[5f00::1]/',
      'https://[100:0:0:1::1]/',
    ])
      expect(rule(address), address).toBe('not_public')
  })

  it('refuses a link with a key in it, and a listed host with its subdomains', () => {
    expect(rule('https://files.example/report.pdf?X-Amz-Signature=abc')).toBe('has_key')
    expect(rule('https://intranet.example.com/x', false, ['intranet.example.com'])).toBe(
      'blocked_host',
    )
    expect(rule('https://wiki.intranet.example.com/x', false, ['intranet.example.com'])).toBe(
      'blocked_host',
    )
    expect(rule('https://notintranet.example.com/x', false, ['intranet.example.com'])).toBe(
      'https://notintranet.example.com/x',
    )
  })

  it('refuses private, loopback, link-local and mapped addresses, credentials and other schemes', () => {
    for (const address of [
      'https://10.1.2.3/',
      'https://192.168.0.1/',
      'https://172.16.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://100.64.0.1/',
      'https://[fd00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:10.0.0.1]/',
      'https://[::ffff:7f00:1]/',
      'https://127.0.0.1/',
      'https://2130706433/',
      'https://[::1]/',
      'https://localhost/',
      'https://intranet.localhost/',
    ])
      expect(rule(address), address).toBe('not_public')
    expect(rule('https://user:secret@example.com/')).toBe('credentials')
    expect(rule('ftp://example.com/')).toBe('not_https')
    expect(rule('file:///etc/passwd')).toBe('not_https')
    expect(rule('javascript:alert(1)')).toBe('not_https')
    expect(rule('not a link')).toBe('not_https')
  })

  it('lets the tests read this machine over http, and still no other private address', () => {
    expect(rule('http://127.0.0.1:8080/x', true)).toBe('http://127.0.0.1:8080/x')
    expect(rule('http://localhost:8080/x', true)).toBe('http://localhost:8080/x')
    expect(rule('http://10.0.0.1/x', true)).toBe('not_public')
  })
})
