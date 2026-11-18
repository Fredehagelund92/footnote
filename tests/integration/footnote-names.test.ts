import { describe, expect, it } from 'vitest'
import { appFamilies } from '../../src/domain/app-family.ts'
import { testDatabase } from './support.ts'

/*
  What the database names after the product (docs/product-name.md): migration 0058 gives the
  functions' lock keys and the agent family of the built-in test runs the name Footnote.
*/

const { client } = testDatabase()

/** The keys of the advisory locks a definition takes. */
const lockKeys = (definition: string) =>
  [...definition.matchAll(/hashtextextended\('([^']+)'/g)].map((match) => match[1])

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
      expect(lockKeys(definition), name).toEqual([
        name.startsWith('auth.bootstrap_person') ? 'footnote.dev_people' : 'footnote.roles',
      ])
      // Defined again with everything else as it was: run as the owner, on a fixed search path.
      expect(definition, name).toContain('SECURITY DEFINER')
      expect(definition, name).toContain("SET search_path TO 'public', 'pg_temp'")
    }
  })

  it('takes exactly the agent families the service knows, the footnote family among them', async () => {
    const { rows } = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(c.oid) as definition from pg_constraint c
        where c.conname in ('mcp_requests_app_family_check', 'deliveries_app_family_check')
          and c.conislocal`,
    )
    expect(rows).toHaveLength(2)
    for (const { definition } of rows) {
      const allowed = [...definition.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1])
      expect(allowed.sort()).toEqual([...appFamilies].sort())
      expect(allowed).toContain('footnote')
    }
  })
})
