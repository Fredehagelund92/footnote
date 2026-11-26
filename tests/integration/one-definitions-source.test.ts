import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type pg from 'pg'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { reconcileSourceFlags } from '../../src/server/modules/connectors/flags.ts'
import { accept, foundation, openEdition, people, publish, version } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

/*
  One definitions integration is on at a time (CON-120, db/migrations/0023_one_definitions_source.sql).
  A database that read two keeps the first connected on, turns the others off, the demo among
  them, and says so once in the history log for each; a content source is not one and stays on.
  From then on the database refuses a second one on. What an integration that is off read is
  neither served nor holds a word, and the live items that rely on it are flagged, until it is on
  again.
*/

const { client } = testDatabase({ unmigrated: true })

/** The terms the live edition serves, by key, with the definitions each is served with. */
const served = async () =>
  (
    await client.query<{ key: string; refs: string[] }>(
      `select key, definition_refs as refs from serving_vocabulary((select seq from live_edition))
        order by key`,
    )
  ).rows

/** Brings the items' flags in line, as a read or a switch does. */
const reconcile = () =>
  transaction(client, () =>
    reconcileSourceFlags({
      query: async <Row extends pg.QueryResultRow>(sql: string, values?: unknown[]) =>
        (await client.query<Row>(sql, values)).rows,
    }),
  )

const flags = async (item: string) =>
  (
    await client.query<{ flag: string; reason: string }>(
      `select o.flag::text, e.reason from v_overlay_on o
         join overlay_events e on e.item_id = o.item_id and e.flag = o.flag and e.kind = 'flag_on'
        where o.item_id = $1 and o.kind = 'flag_on'`,
      [item],
    )
  ).rows

it('keeps one definitions integration on, serves only what it read, and refuses a second', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'footnote-one-definitions-'))
  const source = pathToFileURL(directory + '/')
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()
  const at = files.indexOf('0023_one_definitions_source.sql')
  expect(at).toBeGreaterThan(0)
  const copy = (name: string) =>
    copyFile(fileURLToPath(new URL(name, migrationDirectory)), join(directory, name))
  try {
    // The database as it was before: the demo, Cube and dbt all on, and a content source.
    for (const name of files.slice(0, at)) await copy(name)
    await migrate(client, source)
    await foundation(client)
    await client.query(
      `insert into connectors (id, kind, type, name, created_at) values
         ('cube', 'definition_source', 'cube', 'Cube model', '2026-10-01T00:00:00Z'),
         ('dbt', 'definition_source', 'dbt-metricflow', 'dbt project', '2026-10-02T00:00:00Z'),
         ('handbook', 'context_source', 'git-markdown', 'Handbook', '2026-10-03T00:00:00Z');
       insert into definitions (ref, connector_id, kind, name, change_mark) values
         ('cube:orders.revenue', 'cube', 'metric', 'orders.revenue', 'c1'),
         ('dbt:orders.revenue', 'dbt', 'metric', 'orders.revenue', 'd1'),
         ('dbt:orders.channel', 'dbt', 'dimension', 'orders.channel', 'd2')`,
    )
    const item = await transaction(client, async () => {
      await client.query(
        `insert into vocab_terms (key, kind) values
           ('metric:revenue', 'metric'), ('metric:dbt_revenue', 'metric'),
           ('dim:channel', 'dimension'), ('val:channel/web', 'dimension_value')`,
      )
      const seq = await openEdition(client)
      // Vocabulary decisions are not what this is about: the fixture owns the baseline.
      await client.query('alter table vocab_term_service disable trigger user')
      for (const [key, name, ref] of [
        ['metric:revenue', 'Revenue', 'cube:orders.revenue'],
        ['metric:dbt_revenue', 'Revenue (dbt)', 'dbt:orders.revenue'],
        ['dim:channel', 'Channel', 'dbt:orders.channel'],
        ['val:channel/web', 'Web', null],
      ] as const) {
        const [term] = (
          await client.query<{ id: string }>(
            `with v as (insert into vocab_term_versions (term_key, name, area_id, content_digest, version_no)
                        values ($1, $2, 'finance', sha256(convert_to($1, 'UTF8')), 1) returning id),
                  r as (insert into vocab_term_refs (version_id, definition_ref)
                        select id, $3 from v where $3::text is not null)
             select id from v`,
            [key, name, ref],
          )
        ).rows
        await client.query(
          `insert into vocab_term_service (term_key, version_id, editions)
           values ($1, $2, int8range($3, null, '[)'))`,
          [key, term!.id, seq],
        )
      }
      await client.query('alter table vocab_term_service enable trigger user')
      await client.query("select set_config('cl.person_id', $1, true)", [people.admin])
      await client.query('select edition_seal($1)', [seq])
      await client.query('select edition_publish($1)', [seq])
      // A live note that relies on dbt's revenue, at the mark it has now.
      const v = await version(client, {
        area: 'finance',
        owner: people.owner,
        title: 'dbt revenue',
      })
      await client.query("insert into item_version_refs values ($1, 'dbt:orders.revenue', 'd1')", [
        v.id,
      ])
      await accept(client, v.id)
      await publish(client, v.id)
      return v.item
    })

    await copy('0023_one_definitions_source.sql')
    expect(await migrate(client, source)).toBe(1)

    // Cube was connected first: it stays on, and the demo and dbt are off. The content source is
    // not a definitions integration, and stays as it was.
    const connectors = await client.query<{ id: string; enabled: boolean }>(
      'select id, enabled from connectors order by id',
    )
    expect(connectors.rows).toEqual([
      { id: 'cube', enabled: true },
      { id: 'dbt', enabled: false },
      { id: 'demo', enabled: false },
      { id: 'handbook', enabled: true },
    ])
    // Said once for each, in the history log, with how to switch.
    const said = await client.query<{ subject_id: string; actor_kind: string; reason: string }>(
      `select subject_id, actor_kind, details->>'reason' as reason from audit_log
        where action = 'source.paused' order by subject_id`,
    )
    const words =
      'Only one definitions integration is on at a time. Cube model stays on, so this one was turned off. To read this one instead, turn Cube model off, then turn this one on.'
    expect(said.rows).toEqual([
      { subject_id: 'dbt', actor_kind: 'system', reason: words },
      { subject_id: 'demo', actor_kind: 'system', reason: words },
    ])
    expect(await migrate(client, source)).toBe(0)

    // Only what Cube read is served: dbt's terms, and the value of its dimension, are not.
    expect(await served()).toEqual([{ key: 'metric:revenue', refs: ['cube:orders.revenue'] }])
    // A term of an integration that is off holds no word, so another can take it.
    const held = await client.query<{ word: string }>(
      "select distinct word from cl_vocabulary_words() where word like '%revenue%' order by word",
    )
    expect(held.rows.map((row) => row.word)).toEqual(['orders.revenue', 'revenue'])
    // The note on dbt's revenue is still served, flagged as relying on an integration that is off.
    await reconcile()
    expect(await flags(item)).toEqual([
      { flag: 'source_missing', reason: 'Its integration is off: dbt:orders.revenue' },
    ])

    // The database refuses a second one on.
    await expect(
      client.query("update connectors set enabled = true where id = 'dbt'"),
    ).rejects.toThrow('connectors_one_definitions_source')
    // Switched, what dbt read is served again, and the flag clears.
    await client.query("update connectors set enabled = false where id = 'cube'")
    await client.query("update connectors set enabled = true where id = 'dbt'")
    expect(await served()).toEqual([
      { key: 'dim:channel', refs: ['dbt:orders.channel'] },
      { key: 'metric:dbt_revenue', refs: ['dbt:orders.revenue'] },
      { key: 'val:channel/web', refs: [] },
    ])
    await reconcile()
    expect(await flags(item)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
