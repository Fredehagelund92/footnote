import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { foundation, people } from './fixtures.ts'
import { testDatabase } from './support.ts'

/*
  Figures in Ask leave version 1 (db/migrations/0018_figures_removed.sql): a database that kept
  figures settings and a figure report before keeps the report, as a report about its context
  item, and nothing of the figures: no settings, no data contact, no figure columns or functions.
*/

const { client } = testDatabase({ unmigrated: true })

it('keeps a figure report as a report about its item, and forgets the figures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'footnote-figures-removed-'))
  const source = pathToFileURL(directory + '/')
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()
  const at = files.indexOf('0018_figures_removed.sql')
  expect(at).toBeGreaterThan(0)
  const copy = (name: string) =>
    copyFile(fileURLToPath(new URL(name, migrationDirectory)), join(directory, name))
  try {
    // The database as it was before: every migration up to this one.
    for (const name of files.slice(0, at)) await copy(name)
    await migrate(client, source)
    await foundation(client)
    await client.query(
      `update connectors set data_contact_id = $1,
         capabilities = '{"figures": {"enabled": true, "endpoint": "https://cube.example.test/cubejs-api/v1/load", "secretRef": "local:figures-token"}}'
       where id = 'demo'`,
      [people.owner],
    )
    await client.query(
      `insert into reports (person_id, area_id, item_id, part, question, what,
         figure_source, figure_metric, figure_values, figure_from, figure_to, figure_route)
       values ($1, 'finance', 'itm_target0001', 'figure', 'Why did orders drop?',
         'The figure does not fit this item.', 'demo', 'metric:orders', '{val:market/norway}',
         '2026-08-01', '2026-08-31', 'contact'),
         ($1, 'finance', 'itm_target0001', 'answer', 'Why did orders drop?', 'Not the answer.',
         null, null, null, null, null, null)`,
      [people.member],
    )

    await copy('0018_figures_removed.sql')
    expect(await migrate(client, source)).toBe(1)

    const reports = await client.query<{ part: string; what: string }>(
      'select part, what from reports order by part, what',
    )
    expect(reports.rows).toEqual([
      { part: 'answer', what: 'Not the answer.' },
      { part: 'item', what: 'The figure does not fit this item.' },
    ])
    // Reports stay append-only, and a figure report can no longer be filed.
    await expect(client.query("update reports set what = 'changed'")).rejects.toThrow('append-only')
    await expect(
      client.query(
        `insert into reports (person_id, area_id, item_id, part, question, what)
         values ($1, 'finance', 'itm_target0001', 'figure', 'q', 'w')`,
        [people.member],
      ),
    ).rejects.toThrow('reports_part_check')
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('reports', 'connectors')
          and (column_name like 'figure%' or column_name = 'data_contact_id')`,
    )
    expect(columns.rows).toEqual([])
    const functions = await client.query<{ proname: string }>(
      "select proname from pg_proc where proname like '%figure%'",
    )
    expect(functions.rows).toEqual([])
    const [demo] = (
      await client.query<{ capabilities: object }>(
        "select capabilities from connectors where id = 'demo'",
      )
    ).rows
    expect(demo!.capabilities).toEqual({})
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
