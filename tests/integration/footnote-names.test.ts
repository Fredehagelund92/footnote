import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { createLocalDatabase, identifier, localRoles } from '../../src/server/db/roles.ts'
import { testDatabase } from './support.ts'

/*
  What the database keeps under the product's former name, Heed, after the rename to Footnote
  (docs/rename-checklist.md, step 10): migration 0058 gives the lock keys and the agent family the
  new name, and the start renames a database made under the old one.
*/

const { client } = testDatabase()

describe('migration 0058', () => {
  it('has the four functions take the locks the service takes, named after Footnote', async () => {
    const { rows } = await client.query<{ name: string; definition: string }>(
      `select p.oid::regprocedure::text as name, pg_get_functiondef(p.oid) as definition
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'auth'
          and p.proname in ('bootstrap_person', 'accept_invite', 'join_by_group', 'sync_group_admin')`,
    )
    expect(rows.map((row) => row.name).sort()).toEqual([
      'auth.accept_invite(text,text)',
      'auth.bootstrap_person(text,text,global_role[])',
      'auth.join_by_group(text,text)',
      'auth.sync_group_admin(uuid,boolean)',
    ])
    for (const { name, definition } of rows) {
      expect(definition, name).not.toContain("'heed.")
      expect(definition, name).toMatch(
        name.startsWith('auth.bootstrap_person') ? /'footnote\.dev_people'/ : /'footnote\.roles'/,
      )
      // Defined again with everything else as it was: run as the owner, on a fixed search path.
      expect(definition, name).toContain('SECURITY DEFINER')
      expect(definition, name).toContain("SET search_path TO 'public', 'pg_temp'")
    }
  })

  it('counts the built-in test runs as the footnote family, never heed', async () => {
    const { rows } = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(c.oid) as definition from pg_constraint c
        where c.conname in ('mcp_requests_app_family_check', 'deliveries_app_family_check')
          and c.conislocal`,
    )
    expect(rows).toHaveLength(2)
    for (const { definition } of rows) {
      expect(definition).toContain("'footnote'")
      expect(definition).not.toContain("'heed'")
    }
  })
})

describe('a database made under the former name', () => {
  const admin = new pg.Client({
    connectionString: Object.assign(new URL(inject('databaseTemplate')), { pathname: '/postgres' })
      .href,
  })
  const stem = `${new URL(inject('databaseTemplate')).pathname.slice(1)}_rename_${randomBytes(4).toString('hex')}`
  const [former, renamed] = [`${stem}_heed`, `${stem}_footnote`]
  beforeAll(async () => {
    await admin.connect()
  })
  afterAll(async () => {
    for (const name of [former, renamed])
      await admin.query(`drop database if exists ${identifier(name)} with (force)`)
    await admin.end()
  })

  it('takes the new name with what it holds, once, and a new one is made when there is none', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await admin.query(`create database ${identifier(former)} owner ${identifier(localRoles.owner)}`)
    const old = new pg.Client({
      connectionString: Object.assign(new URL(inject('databaseTemplate')), {
        pathname: `/${former}`,
      }).href,
    })
    await old.connect()
    await old.query('create table kept (note text)')
    await old.query("insert into kept values ('written before the rename')")
    await old.end()

    expect(await createLocalDatabase(admin, renamed, former)).toBe(false)
    const names = await admin.query<{ datname: string }>(
      'select datname from pg_database where datname = any($1) order by datname',
      [[former, renamed]],
    )
    expect(names.rows.map((row) => row.datname)).toEqual([renamed])
    const moved = new pg.Client({
      connectionString: Object.assign(new URL(inject('databaseTemplate')), {
        pathname: `/${renamed}`,
      }).href,
    })
    await moved.connect()
    expect((await moved.query('select note from kept')).rows).toEqual([
      { note: 'written before the rename' },
    ])
    await moved.end()
    expect(console.log).toHaveBeenCalledWith(`Renamed the database ${former} to ${renamed}`)

    // Once there, it is kept, and with neither there a new one is made.
    expect(await createLocalDatabase(admin, renamed, former)).toBe(false)
    await admin.query(`drop database ${identifier(renamed)} with (force)`)
    expect(await createLocalDatabase(admin, renamed, former)).toBe(true)
    vi.restoreAllMocks()
  })
})
