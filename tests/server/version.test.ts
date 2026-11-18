import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildApp } from '../../src/server/app.ts'
import type { Database } from '../../src/server/db/database.ts'
import { openApiDocument } from '../../src/server/http/api.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { footnoteVersion } from '../../src/server/version.ts'
import { idleJobs } from './idle-jobs.ts'

/*
  Footnote has one version, written in package.json and raised by the release pull request
  (docs/releasing.md). Everything else that names a version must name that one, the published
  images the README's Quick start pulls among them. The MCP server info is checked on the wire in
  tests/server/mcp/conformance.test.ts.
*/

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8')) as T

const { version } = await readJson<{ version: string }>('package.json')

const reachable: Database = {
  transaction: (_person, work) => work(reachable),
  ping: () => Promise.resolve(),
  query: () => Promise.resolve([]),
  close: () => Promise.resolve(),
}

describe("Footnote's version", () => {
  it('is a plain release number', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('is what the service reads', () => {
    expect(footnoteVersion).toBe(version)
  })

  it("is the lockfile's, and the release tool's last release", async () => {
    const lock = await readJson<{ version: string; packages: Record<string, { version: string }> }>(
      'package-lock.json',
    )
    expect(lock.version).toBe(version)
    expect(lock.packages['']?.version).toBe(version)
    expect(await readJson('.release-please-manifest.json')).toEqual({ '.': version })
  })

  it('names the OpenAPI document, as served and as written in docs/api', async () => {
    expect((await openApiDocument()).info.version).toBe(version)
    const written = await readJson<{ info: { version: string } }>('docs/api/openapi.json')
    expect(written.info.version).toBe(version)
  })

  it('names the images compose.images.yaml pulls, on lines the release pull request writes', async () => {
    const file = await readFile(new URL('../../compose.images.yaml', import.meta.url), 'utf8')
    const { services } = parse(file) as { services: Record<string, { image: string }> }
    expect(services.heed?.image).toBe(`ghcr.io/fredehagelund92/heed:${version}`)
    expect(services.web?.image).toBe(`ghcr.io/fredehagelund92/heed-web:${version}`)
    for (const line of file.split('\n').filter((line) => line.includes(' image: ')))
      expect(line).toMatch(/ # x-release-please-version$/)
    const config = await readJson<{ packages: Record<string, { 'extra-files': unknown[] }> }>(
      'release-please-config.json',
    )
    expect(config.packages['.']?.['extra-files']).toContainEqual({
      type: 'generic',
      path: 'compose.images.yaml',
    })
  })

  it('is on /health and /health/ready', async () => {
    const app = buildApp({
      database: reachable,
      jobs: idleJobs(),
      logger: createLogger({ level: 'silent' }),
    })
    try {
      for (const url of ['/health', '/health/ready']) {
        const response = await app.inject({ method: 'GET', url })
        expect(response.json()).toMatchObject({ version })
      }
    } finally {
      await app.close()
    }
  })
})
