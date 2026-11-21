import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadConfig } from '../../../src/server/config/env.ts'
import { configuredSources } from '../../../src/server/modules/connectors/index.ts'

/*
  dbt on this computer with `docker compose up` (docs/use-your-own-data.md, "Read dbt on this
  computer"): DBT_MANIFEST_DIR names the folder of the semantic manifest `dbt parse` writes.
  compose.yaml shares it into the container read only and names it in FOOTNOTE_SERVER_FOLDERS as
  the server's own dbt folder, and the image's start then reads no demo model beside it. Unset,
  the demo starts as before.
*/

type Service = { environment: Record<string, string | null>; volumes: string[] }
const root = new URL('../../../', import.meta.url)
const compose = parse(await readFile(new URL('compose.yaml', root), 'utf8')) as {
  services: Record<string, Service>
  volumes: Record<string, unknown>
}
const footnote = compose.services['footnote']!

/**
 * Compose's `${NAME:+word}` and `${NAME:-word}` as `docker compose config` writes them, for a
 * shell that sets `shell`: the word may hold braces of its own, as a JSON object does.
 */
function interpolate(text: string, shell: Record<string, string>): string {
  let out = ''
  for (let at = 0; at < text.length;) {
    const start = text.indexOf('${', at)
    if (start < 0) return out + text.slice(at)
    out += text.slice(at, start)
    let depth = 0
    let end = start + 2
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      if (text[end] === '}' && depth-- === 0) break
    }
    const [, name, sign, word] = /^(\w+):([+-])(.*)$/s.exec(text.slice(start + 2, end))!
    const set = Boolean(shell[name!])
    out += sign === '+' ? (set ? word : '') : set ? shell[name!] : word
    at = end + 1
  }
  return out
}

/** The service's dbt folder setting and the volume shared at its folder, for a shell. */
function service(shell: Record<string, string>) {
  const folders = interpolate(footnote.environment['FOOTNOTE_SERVER_FOLDERS']!, shell)
  const volume = footnote.volumes
    .map((entry) => interpolate(entry, shell))
    .find((entry) => entry.includes(':/dbt-manifest'))!
  return { folders, volume: volume.split(':') }
}

describe('a dbt folder on this computer in compose', () => {
  it('names no folder and shares an empty volume when DBT_MANIFEST_DIR is unset', () => {
    const { folders, volume } = service({})
    expect(folders).toBe('')
    expect(loadConfig({ DATABASE_URL: 'postgres://x@db/footnote' }).serverFolders).toEqual({})
    expect(Object.keys(compose.volumes)).toContain(volume[0])
  })

  it('shares the folder read only, where the service reads it as its own dbt source', () => {
    const { folders, volume } = service({ DBT_MANIFEST_DIR: '/home/ana/shop-dbt/target' })
    const [from, to, mode] = volume
    expect([from, mode]).toEqual(['/home/ana/shop-dbt/target', 'ro'])
    const config = loadConfig({
      DATABASE_URL: 'postgres://x@db/footnote',
      FOOTNOTE_SERVER_FOLDERS: folders,
    })
    expect(config.serverFolders).toEqual({ 'dbt-metricflow': to })
    // The dbt folder alone: no demo beside it.
    expect(configuredSources({ ...config, cubeModelDir: undefined }).map((s) => s.id)).toEqual([
      'dbt-metricflow',
    ])
  })

  it("leaves the image's demo model out beside a server folder, and keeps it otherwise", async () => {
    const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8')
    const start = JSON.parse(/^CMD (\[.*\])$/m.exec(dockerfile)![1]!) as string[]
    const line = start[2]!.replace(
      'node db/prepare.ts && exec node src/server/main.ts',
      'printf %s "$CUBE_MODEL_DIR"',
    )
    const cubeFolder = async (env: Record<string, string>) =>
      (await promisify(execFile)('sh', ['-c', line], { env: { PATH: process.env.PATH, ...env } }))
        .stdout
    expect(await cubeFolder({ NODE_ENV: 'development' })).toBe('/app/db/seed/cube')
    expect(
      await cubeFolder({
        NODE_ENV: 'development',
        FOOTNOTE_SERVER_FOLDERS: service({ DBT_MANIFEST_DIR: '/x' }).folders,
      }),
    ).toBe('')
    expect(await cubeFolder({ NODE_ENV: 'development', FOOTNOTE_SERVER_FOLDERS: '' })).toBe(
      '/app/db/seed/cube',
    )
  })
})
