import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type pg from 'pg'
import { afterAll, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/catalogue.ts'
import type { NamesRead } from '../../src/contract/inbox.ts'
import { contentDigest } from '../../src/domain/canonical.ts'
import { termDigestContent, type Term } from '../../src/domain/vocabulary.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { applyGrants } from '../../src/server/db/roles.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { acceptTermVersions } from '../../src/server/modules/review/term-versions.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, queueReads, testDatabase, transaction } from './support.ts'

/*
  Families of one name accepted before a family's name was a word it held (0005) stay told apart
  once (db/migrations/0025_family_names_told_apart.sql), on the real service and PostgreSQL 18. An
  invented revenue model has a forecast revenue in EUR and USD joined into three views, as the
  company model that showed "Forecast Revenue" three times in Definitions has. The database is put
  in the state the old code left: each later family a new version under the first one's name, or
  under a metric's. The migration gives each its view's name after it, in an edition of its own,
  and Definitions shows every name once.

  The service of today writes that state, so the database has every migration, as today's code
  needs: the migration's own statements then run again on what the old code left. On the empty
  database the migrate step started from, they found nothing to tell apart.
*/

const { client, url } = testDatabase({ unmigrated: true })
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-11-21')
const folder = await mkdtemp(join(tmpdir(), 'footnote-names-told-apart-'))
const migrations = await mkdtemp(join(tmpdir(), 'footnote-names-told-apart-migrations-'))
const view = (name: string, cube = 'revenue') => [
  `  - name: ${name}`,
  '    meta:',
  '      domain: sales',
  '    cubes:',
  `      - join_path: ${cube}`,
  "        includes: '*'",
]
await writeFile(
  join(folder, 'model.yml'),
  [
    'cubes:',
    '  - name: revenue',
    '    public: false',
    '    sql: SELECT * FROM revenue',
    '    measures:',
    '      - name: forecast_revenue_eur',
    '        type: sum',
    '        sql: forecast',
    '        title: "Forecast Revenue (EUR)"',
    '        description: The planned revenue in each period, in EUR.',
    '      - name: forecast_revenue_usd',
    '        type: sum',
    '        sql: "forecast * fx_rate"',
    '        title: "Forecast Revenue (USD)"',
    "        description: The EUR amount multiplied by the row's exchange rate.",
    '  - name: orders',
    '    public: false',
    '    sql: SELECT * FROM orders',
    '    measures:',
    '      - name: bookings',
    '        type: count',
    '        title: Bookings',
    '        description: Every booking made.',
    'views:',
    ...view('commercial_revenue'),
    ...view('sponsorships'),
    ...view('subscriptions'),
    ...view('order_book', 'orders'),
    '',
  ].join('\n'),
)
const registry = new ConnectorRegistry([createCubeSource({ modelDir: folder })])
const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()
const at = files.indexOf('0024_names_told_apart_reason.sql')
const copy = (name: string) =>
  copyFile(fileURLToPath(new URL(name, migrationDirectory)), join(migrations, name))

afterAll(async () => {
  await rm(folder, { recursive: true, force: true })
  await rm(migrations, { recursive: true, force: true })
})

type Live = Pick<
  Term,
  'key' | 'kind' | 'parentKey' | 'name' | 'aliases' | 'areaId' | 'definitionRefs'
> & { digest: string; versionNo: number; reason: string }

const live = async () =>
  (
    await client.query<Live>(
      `select t.key, t.kind::text as kind, v.parent_key as "parentKey", v.name, v.aliases,
              v.area_id as "areaId", v.version_no as "versionNo", e.reason::text as reason,
              coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
                          from vocab_term_refs r where r.version_id = v.id), '{}') as "definitionRefs",
              encode(v.content_digest, 'hex') as digest
         from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
         join vocab_terms t on t.key = s.term_key join editions e on e.seq = lower(s.editions)
        where s.editions @> (select seq from live_edition)
        order by t.key`,
    )
  ).rows

it('gives each later family of one name its view’s name after it, once', async () => {
  expect(at).toBeGreaterThan(0)
  for (const name of files) await copy(name)
  await migrate(client, pathToFileURL(migrations + '/'))
  await applyGrants(client)
  await foundation(client)
  await client.query("insert into areas (id,name) values ('sales','Sales')")

  const database = apiDatabase(url)
  const app = buildApp({
    database,
    jobs: idleJobs(),
    sources: registry,
    logger,
    clock,
    devPeople: [{ name: 'admin', email: 'admin@example.test', roles: [] }],
  })
  try {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-footnote-csrf': 'dev-sign-in' },
      payload: { email: 'admin@example.test' },
    })
    expect(signedIn.statusCode, signedIn.body).toBe(200)
    const headers = {
      origin: 'http://localhost',
      cookie: signedIn.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-footnote-csrf': signedIn.json<{ csrfToken: string }>().csrfToken,
    }
    const call = async <T>(method: 'GET' | 'POST', path: string, payload?: object) => {
      const response = await app.inject({
        method,
        url: '/api/v1' + path,
        headers: { ...headers, 'idempotency-key': randomUUID() },
        ...(payload ? { payload } : {}),
      })
      expect(response.statusCode, response.body).toBe(200)
      return response.json<T>()
    }
    const familyNames = async () =>
      (await call<Catalogue>('GET', '/catalogue')).terms
        .filter((term) => term.family)
        .map((term) => term.name)

    // Read and publish everything as Footnote names it today: three families, three words.
    await queueReads(client)
    await connectorSyncJob(registry, { clock }).run({
      database,
      logger,
      signal: new AbortController().signal,
    })
    const waiting = await call<NamesRead>('GET', '/inbox/names')
    await call('POST', '/inbox/names/decide', {
      revision: waiting.revision,
      accept: waiting.names.map(({ key }) => ({ key })),
      leaveOut: [],
    })
    expect(await familyNames()).toEqual([
      'Forecast Revenue',
      'Forecast Revenue (sponsorships)',
      'Forecast Revenue (subscriptions)',
    ])

    // What the old code left: the later families accepted under a word another already held,
    // one the first family's, one a live metric's.
    const legacy: Record<string, string> = {
      'group:sponsorships_forecast_revenue': 'Forecast Revenue',
      'group:subscriptions_forecast_revenue': 'Bookings',
    }
    await transaction(client, async () => {
      await client.query("select set_config('cl.person_id', $1, true)", [people.admin])
      const terms = (await live()).filter((term) => term.key in legacy)
      expect(terms).toHaveLength(2)
      await acceptTermVersions(
        {
          query: <Row extends pg.QueryResultRow>(text: string, values?: unknown[]) =>
            client.query<Row>(text, values).then((result) => result.rows),
        },
        terms.map(({ key, kind, parentKey, aliases, areaId, definitionRefs }) => ({
          key,
          kind,
          parentKey,
          name: legacy[key]!,
          aliases,
          areaId,
          definitionRefs,
          action: 'change',
          base: null,
          capacity: 'administrator',
        })),
        { channel: 'import', reason: 'Accepted the names a read made.', areaId: null },
      )
    })
    expect(await familyNames()).toEqual(['Bookings', 'Forecast Revenue', 'Forecast Revenue'])
    const before = await live()

    await client.query(
      await readFile(
        fileURLToPath(new URL('0025_family_names_told_apart.sql', migrationDirectory)),
        'utf8',
      ),
    )

    expect(await familyNames()).toEqual([
      'Bookings (subscriptions)',
      'Forecast Revenue',
      'Forecast Revenue (sponsorships)',
    ])
    // One word, one meaning again (FR-138): no live word is held by two terms.
    const shared = await client.query(
      `select word from cl_vocabulary_words() where origin = 'vocabulary'
        group by word having count(distinct key) > 1`,
    )
    expect(shared.rows).toEqual([])

    // Only the two later families changed: new versions, their keys, variants and domains kept,
    // each with the digest the write path works out for it.
    const after = await live()
    const changed = after.filter((term) => term.reason === 'names_told_apart')
    expect(changed.map(({ key, name, versionNo }) => [key, name, versionNo])).toEqual([
      ['group:sponsorships_forecast_revenue', 'Forecast Revenue (sponsorships)', 3],
      ['group:subscriptions_forecast_revenue', 'Bookings (subscriptions)', 3],
    ])
    const unchanged = (terms: Live[]) =>
      terms.filter((term) => !(term.key in legacy)).map(({ reason: _reason, ...term }) => term)
    expect(unchanged(after)).toEqual(unchanged(before))
    for (const term of changed) {
      const was = before.find((other) => other.key === term.key)!
      expect([term.areaId, term.definitionRefs, term.aliases]).toEqual([
        was.areaId,
        was.definitionRefs,
        was.aliases,
      ])
      const { digest, versionNo: _versionNo, reason: _reason, ...content } = term
      expect(await contentDigest(termDigestContent(content))).toBe(digest)
    }

    // One edition, sealed and live, that nobody made, and the history log says what it did.
    const editions = await client.query(
      `select e.reason::text as reason, e.actor_id as actor, e.note, e.sealed_at is not null as sealed,
              e.seq = (select seq from live_edition) as live,
              e.digest = edition_content_digest(e.seq) as whole
         from editions e where e.reason = 'names_told_apart'`,
    )
    expect(editions.rows).toEqual([
      {
        reason: 'names_told_apart',
        actor: null,
        note: "Families of one name were told apart: each later one has its view's name after it.",
        sealed: true,
        live: true,
        whole: true,
      },
    ])
    const told = await client.query(
      `select actor_kind, details from audit_log where action = 'names.told_apart'`,
    )
    expect(told.rows).toEqual([
      {
        actor_kind: 'system',
        details: {
          names: [
            {
              key: 'group:sponsorships_forecast_revenue',
              from: 'Forecast Revenue',
              to: 'Forecast Revenue (sponsorships)',
            },
            {
              key: 'group:subscriptions_forecast_revenue',
              from: 'Bookings',
              to: 'Bookings (subscriptions)',
            },
          ],
        },
      },
    ])
    // The live families wait for nothing: the names card has none of them.
    const { names } = await call<NamesRead>('GET', '/inbox/names')
    expect(names.filter((name) => name.kind === 'metric_group')).toEqual([])
  } finally {
    await app.close()
  }
}, 180_000)
