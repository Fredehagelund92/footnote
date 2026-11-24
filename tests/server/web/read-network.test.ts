import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPageReader, PageReadError } from '../../../src/server/modules/web/index.ts'

/*
  What the page reader connects through (FR-144): directly, to the answer it checked, even when
  the process is told to use an outbound proxy (HTTPS_PROXY with NODE_USE_ENV_PROXY), so the
  address rules hold; and only to a site whose certificate is valid.
*/

const run = promisify(execFile)
const reader = new URL('../../../src/server/modules/web/index.ts', import.meta.url).href

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}
const close = (server: Server) => {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(resolve))
}

describe('an outbound proxy', () => {
  const hits: string[] = []
  const page = createServer((request, response) => {
    hits.push(`page ${request.url}`)
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('Read directly.')
  })
  const proxy = createServer((request, response) => {
    hits.push(`proxy ${request.url}`)
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('Read through the proxy.')
  })
  proxy.on('connect', (request, socket) => {
    hits.push(`proxy ${request.url}`)
    socket.end()
  })
  let pagePort = 0
  let proxyPort = 0
  beforeAll(async () => {
    pagePort = await listen(page)
    proxyPort = await listen(proxy)
  })
  afterAll(async () => {
    await close(page)
    await close(proxy)
  })

  it('is never used: the reader connects to the checked answer directly', async () => {
    // A process that reads its proxy from the environment, as Node does with NODE_USE_ENV_PROXY.
    // pages.localhost answers this machine; a plain request, the control, goes through the proxy.
    const script = `
      import dns from 'node:dns'
      import http from 'node:http'
      import { syncBuiltinESMExports } from 'node:module'
      const answer = [{ address: '127.0.0.1', family: 4 }]
      dns.lookup = (host, options, callback) =>
        options.all ? callback(null, answer) : callback(null, '127.0.0.1', 4)
      syncBuiltinESMExports()
      const { createPageReader } = await import(${JSON.stringify(reader)})
      const address = 'http://pages.localhost:${pagePort}/notice'
      const page = await createPageReader({ loopback: true })(address)
      const control = await new Promise((resolve, reject) =>
        http.get(address, (response) => {
          let text = ''
          response.on('data', (chunk) => (text += chunk))
          response.on('end', () => resolve(text))
        }).on('error', reject),
      )
      console.log(JSON.stringify({ page: page.paragraphs, control }))
    `
    const proxied = `http://127.0.0.1:${proxyPort}`
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: proxied,
        HTTPS_PROXY: proxied,
        NO_PROXY: '',
        no_proxy: '',
      },
    })
    expect(JSON.parse(stdout)).toEqual({
      page: ['Read directly.'],
      control: 'Read through the proxy.',
    })
    expect(hits).toEqual(['page /notice', `proxy http://pages.localhost:${pagePort}/notice`])
  })
})

describe('a certificate', () => {
  let dir = ''
  let server: Server
  let port = 0
  beforeAll(async () => {
    // A certificate nobody issued: made here, for this machine only.
    dir = mkdtempSync(join(tmpdir(), 'footnote-cert-'))
    await run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ])
    server = createTlsServer(
      { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('Self-signed.')
      },
    )
    port = await listen(server)
  })
  afterAll(async () => {
    await close(server)
    rmSync(dir, { recursive: true, force: true })
  })

  it('that is not valid fails as no answer', async () => {
    const failure = await createPageReader({ loopback: true })(`https://127.0.0.1:${port}/`).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(PageReadError)
    expect((failure as PageReadError).reason).toBe('unreachable')
  })
})
