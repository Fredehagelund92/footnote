import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  databaseName,
  demoModelDir,
  isEmpty,
  isMissingStory,
  migrateDatabase,
  prepare,
  PrepareError,
  seedDemoIfEmpty,
} from '../../db/prepare.ts'
import { migrationDirectory } from '../../src/server/db/migrate.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { testDatabase } from './support.ts'

const { client, url } = testDatabase({ unmigrated: true })

/*
  Getting a new database ready (db/prepare.ts, `npm run db:migrate` and the container's start):
  every migration once, and the demo only into an empty database beside the demo model. The demo
  itself is seed-demo.test.ts's.
*/
it('migrates a new database once, and leaves the demo out beside another model or other data', async () => {
  const owner = new URL(url)
  owner.searchParams.set('options', `-c role=${localRoles.owner}`)
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql'))

  expect(await migrateDatabase({ bootstrapUrl: admin.href, migrateUrl: owner.href })).toEqual({
    created: false,
    applied: files.length,
  })
  expect(await migrateDatabase({ migrateUrl: owner.href })).toEqual({ created: false, applied: 0 })
  await client.query('reset role')
  expect(await isEmpty(client)).toBe(true)

  const model = await mkdtemp(join(tmpdir(), 'footnote-model-'))
  try {
    await cp(demoModelDir, model, { recursive: true })
    await writeFile(join(model, 'orders.yml'), '# my own model\n', { flag: 'a' })
    expect(await seedDemoIfEmpty({ seedUrl: url, cubeModelDir: model })).toBe('not-demo-model')
  } finally {
    await rm(model, { recursive: true })
  }
  await client.query(
    "insert into people (id, email, display_name) values (gen_random_uuid(), 'first@example.test', 'First')",
  )
  await client.query(
    "insert into areas (id, name, label, summary, description) values ('area_own', 'Own', 'gray', 'Mine', 'Mine')",
  )
  expect(await isEmpty(client)).toBe(false)
  expect(await isMissingStory(client)).toBe(false)
  expect(await seedDemoIfEmpty({ seedUrl: url, cubeModelDir: demoModelDir })).toBe('not-empty')
  const [items] = (await client.query<{ n: number }>('select count(*)::int as n from items')).rows
  expect(items!.n).toBe(0)
})

/*
  The demo first, your own definitions second, on the same database: what `docker compose up` and
  then `CUBE_MODEL_DIR=... docker compose up` give on one Docker volume. The start stops before the
  service can read your names into the demo company's workspace, and says the way out.
*/
it('refuses a database that holds the demo when the start names definitions of your own', async () => {
  const owner = new URL(url)
  owner.searchParams.set('options', `-c role=${localRoles.owner}`)
  const env = { DATABASE_URL_MIGRATE: owner.href }
  const model = await mkdtemp(join(tmpdir(), 'footnote-model-'))
  try {
    await writeFile(join(model, 'invoices.yml'), 'cubes: []\n')
    // Not the demo's database yet: your own model starts on it, as it did in the test above.
    await expect(prepare({ ...env, CUBE_MODEL_DIR: model })).resolves.toBeUndefined()
    // The demo's Sandbox domain, which only its seed makes: the database holds the demo.
    await client.query(
      "insert into areas (id, name, label, summary, description, is_demo) values ('area_sandbox', 'Sandbox', 'gray', '', '', true)",
    )
    const refusal = await prepare({ ...env, CUBE_MODEL_DIR: model }).catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(PrepareError)
    expect((refusal as Error).message).toBe(
      `The database ${databaseName(url)} holds the demo, and CUBE_MODEL_DIR names a Cube model of your own. ` +
        "Starting would mix the two: your names in the demo company's workspace, beside its people and its context. So this start stops here. " +
        'To start empty on your own definitions, run docker compose down --volumes, which deletes the whole database of this demo install, then start again the same way. ' +
        'Without Docker, name an empty database in DATABASE_URL_MIGRATE. ' +
        'To go back to the demo, start without that setting.',
    )
    // A dbt folder of your own is refused the same way, by the setting docker compose gives it.
    await expect(
      prepare({ ...env, FOOTNOTE_SERVER_FOLDERS: JSON.stringify({ 'dbt-metricflow': model }) }),
    ).rejects.toThrow(
      'FOOTNOTE_SERVER_FOLDERS, which docker compose sets from DBT_MANIFEST_DIR, names a folder of your own definitions',
    )
  } finally {
    await rm(model, { recursive: true })
  }
  // The demo beside its own model, or no model named, starts as before.
  await expect(prepare({ ...env, CUBE_MODEL_DIR: demoModelDir })).resolves.toBeUndefined()
  await expect(prepare(env)).resolves.toBeUndefined()
})
