import { readFile } from 'node:fs/promises'
import type pg from 'pg'

export const localRoles = {
  owner: 'context_layer_owner',
  api: 'context_layer_api',
  serve: 'context_layer_serve',
  readonly: 'context_layer_readonly',
}

export function identifier(value: string) {
  return '"' + value.replaceAll('"', '""') + '"'
}

export async function createLocalRoles(client: pg.Client) {
  await client.query('begin')
  try {
    await client.query("select pg_advisory_xact_lock(hashtextextended('footnote.local_roles', 0))")
    for (const [kind, role] of Object.entries(localRoles)) {
      const existing = await client.query('select 1 from pg_roles where rolname = $1', [role])
      if (!existing.rowCount) {
        await client.query(
          `create role ${identifier(role)} login nosuperuser nocreaterole noinherit nobypassrls ${kind === 'owner' ? 'createdb' : 'nocreatedb'}`,
        )
      }
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

export async function applyGrants(client: pg.Client, roles = localRoles) {
  const template = await readFile(
    new URL('../../../db/bootstrap/grants.sql', import.meta.url),
    'utf8',
  )
  const sql = template.replace(
    /:(api|serve|readonly)\b/g,
    (_, role: 'api' | 'serve' | 'readonly') => identifier(roles[role]),
  )
  await client.query('begin')
  try {
    await client.query(sql)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

/** The database compose.yaml names, by its name before the product was renamed Footnote. */
export const formerDatabaseNames: ReadonlyMap<string, string> = new Map([['footnote', 'heed']])

/**
 * Creates the database, owned by the owner role, when it is missing, and lets only Footnote's roles
 * connect to it. Run as a superuser, after `createLocalRoles`. Returns whether it created it.
 *
 * A database made before the rename to Footnote is renamed instead, once: when the database is
 * missing and one under its former name is there, owned by the owner role, it takes the new name
 * with everything in it (docs/operations.md, "Upgrade from Heed 0.1"). Nothing may be connected to
 * it then, which holds at the container's start, before the service runs.
 */
export async function createLocalDatabase(
  client: pg.Client,
  name: string,
  former = formerDatabaseNames.get(name),
): Promise<boolean> {
  const exists = await client.query('select 1 from pg_database where datname = $1', [name])
  const renamed =
    !exists.rowCount && former
      ? await client.query(
          `select 1 from pg_database d join pg_roles r on r.oid = d.datdba
            where d.datname = $1 and r.rolname = $2`,
          [former, localRoles.owner],
        )
      : null
  if (renamed?.rowCount) {
    await client.query(`alter database ${identifier(former!)} rename to ${identifier(name)}`)
    console.log(`Renamed the database ${former} to ${name}`)
  } else if (!exists.rowCount)
    await client.query(`create database ${identifier(name)} owner ${identifier(localRoles.owner)}`)
  await client.query(`revoke connect on database ${identifier(name)} from public`)
  await client.query(
    `grant connect on database ${identifier(name)} to ${Object.values(localRoles).map(identifier).join(', ')}`,
  )
  return !exists.rowCount && !renamed?.rowCount
}
