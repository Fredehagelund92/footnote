import type * as Dns from 'node:dns'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageReader, PageReadError } from '../../../src/server/modules/web/index.ts'

/*
  How the page reader resolves a name (FR-144), with the lookup scripted: a name with one
  private answer among public ones is refused, an address on another port is refused before any
  lookup, and every connection is made to the answer its own lookup checked, so a name that
  answers inside the network on its second lookup (DNS rebinding) is refused there. A name that
  leads to an address an admin listed is refused too.
*/

const lookups: string[] = []
/** Each name's answers, one list a lookup; the last list stays. */
const script = new Map<string, string[][]>()

vi.mock('node:dns', async (original) => {
  const actual = await original<typeof Dns>()
  const lookup = (
    hostname: string,
    options: { all?: boolean },
    callback: (error: Error | null, address: unknown, family?: number) => void,
  ) => {
    lookups.push(hostname)
    const answers = script.get(hostname)
    if (!answers) return actual.lookup(hostname, options, callback as never)
    const list = (answers.length > 1 ? answers.shift() : answers[0])!.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }))
    queueMicrotask(() =>
      options.all ? callback(null, list) : callback(null, list[0]!.address, list[0]!.family),
    )
  }
  return { ...actual, default: { ...actual, lookup }, lookup }
})

let server: Server
let port = 0
const hits: string[] = []
beforeAll(async () => {
  server = createServer((request, response) => {
    hits.push(request.url ?? '/')
    if (request.url === '/hop') {
      response.writeHead(302, { location: '/page' })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<p>Read.</p>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})
beforeEach(() => {
  lookups.length = 0
  hits.length = 0
  script.clear()
})

async function refusal(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof PageReadError) return error.reason
    throw error
  }
  throw new Error('The page was read')
}

describe('resolving a name', () => {
  it('refuses a name with one private answer among public ones, without connecting', async () => {
    script.set('mixed.example', [['93.184.215.14', '10.0.0.1']])
    expect(await refusal(createPageReader()('https://mixed.example/notice'))).toBe('not_public')
    expect(lookups).toEqual(['mixed.example'])
  })

  it('refuses another port before any lookup', async () => {
    script.set('example.com', [['93.184.215.14']])
    expect(await refusal(createPageReader()('https://example.com:8443/'))).toBe('port')
    expect(await refusal(createPageReader()('http://example.com:8080/'))).toBe('port')
    expect(lookups).toEqual([])
  })

  it('connects to the answer it checked, and checks the lookup of every hop again', async () => {
    // The first lookup answers this machine, where the page is; the next one an inside address.
    script.set('rebind.localhost', [['127.0.0.1'], ['10.0.0.1']])
    const read = createPageReader({ loopback: true })
    expect(await refusal(read(`http://rebind.localhost:${port}/hop`))).toBe('not_public')
    expect(lookups).toEqual(['rebind.localhost', 'rebind.localhost'])
    // The first connection reached the checked answer; the second was never made.
    expect(hits).toEqual(['/hop'])
  })

  it('refuses a name that leads to an address an admin listed, whatever the name', async () => {
    script.set('other-name.localhost', [['127.0.0.1']])
    const read = createPageReader({ loopback: true })
    expect(
      await refusal(
        read(`http://other-name.localhost:${port}/page`, { blockedHosts: ['127.0.0.1'] }),
      ),
    ).toBe('blocked_host')
    expect(hits).toEqual([])
    expect((await read(`http://other-name.localhost:${port}/page`)).paragraphs).toEqual(['Read.'])
  })
})
