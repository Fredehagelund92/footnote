import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import * as z from 'zod'
import type { SignInPerson } from '../../../contract/auth.ts'
import type { Queryable } from '../../db/database.ts'
import { initialsOf } from './people.ts'
import {
  currentSession,
  defaultLifetime,
  endSession,
  principalFor,
  startSession,
  type Session,
  type SessionLifetime,
  type SessionMethod,
} from './sessions.ts'

const personSchema = z
  .object({
    email: z.email().toLowerCase(),
    name: z.string().trim().min(1),
    roles: z.array(z.enum(['administrator'])).default([]),
  })
  .strict()
const peopleSchema = z
  .array(personSchema)
  .min(1)
  .superRefine((people, ctx) => {
    if (new Set(people.map((p) => p.email)).size !== people.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate dev person email' })
  })
export type DevPerson = z.infer<typeof personSchema>
export async function readDevPeople(path: string): Promise<DevPerson[]> {
  return peopleSchema.parse(parse(await readFile(path, 'utf8')))
}
/** Who the first person says they are: the workspace's first admin. */
export type FirstPerson = { email: string; name: string }
export interface SignIn {
  /** How this install signs people in (FOOTNOTE_AUTH). */
  readonly method: SessionMethod
  readonly lifetime: SessionLifetime
  /**
   * Who the sign-in screen offers, in order, with the roles each holds now and the domains of
   * those roles. A listed person not signed in yet shows the roles the list gives them. None
   * when people sign in with their company's provider.
   */
  choices(tx: Queryable): Promise<SignInPerson[]>
  /**
   * Whether the sign-in screen asks the first person who they are: the picker of a workspace
   * that has nobody yet. Never with a list of people, on the demo or with a company's provider.
   */
  first(tx: Queryable): Promise<boolean>
  /**
   * Makes the first person of a workspace that has nobody, as its admin, and signs them in; null
   * when someone is there already, or when this sign-in has people of its own.
   */
  setUp(
    tx: Queryable,
    person: FirstPerson,
    cookie: string | undefined,
  ): Promise<{ token: string; session: Session } | null>
  currentSession(tx: Queryable, cookie: string | undefined): Promise<Session | null>
  /** The picker's sign-in, by email; null when there is no picker or nobody by that address. */
  signIn(
    tx: Queryable,
    email: string,
    cookie: string | undefined,
  ): Promise<{ token: string; session: Session } | null>
  signOut(tx: Queryable, cookie: string | undefined): Promise<void>
  /**
   * The person's audience groups (FR-405, CON-401). The dev connector knows none, so a person
   * reads the items for everyone only (CON-403).
   */
  groups(tx: Queryable, personId: string): Promise<readonly string[]>
}

/** Whether the database holds the demo: its sandbox domain, which only the demo's seed makes. */
export async function holdsDemo(tx: Queryable): Promise<boolean> {
  const [row] = await tx.query<{ demo: boolean }>(
    'select exists (select 1 from areas where is_demo) as demo',
  )
  return row!.demo
}

const active = 'deactivated_at is null and erased_at is null'

/**
 * The picker (FOOTNOTE_AUTH=dev, or demo for demos): a person chooses whom to be. Refused in
 * production, where people sign in with their company's provider.
 *
 * Whom it offers: the people of `listed`, a list the host gave, whatever the database holds. With
 * none listed, the `sample` people while this is the demo (its own sign-in, or the demo loaded),
 * and off the demo the people of the workspace itself. A workspace of its own data has nobody at
 * first, so its first visitor says who they are and becomes its admin (`first`, `setUp`): no
 * sample person is ever made beside real data.
 */
export function createDevSignIn(
  listed: readonly DevPerson[],
  nodeEnv = process.env.NODE_ENV,
  options: {
    method?: 'dev' | 'demo'
    lifetime?: SessionLifetime
    sample?: readonly DevPerson[]
  } = {},
): SignIn {
  const method = options.method ?? 'dev'
  if (nodeEnv === 'production')
    throw new Error(
      `${method === 'dev' ? 'Dev' : 'Demo'} sign-in is refused when NODE_ENV=production`,
    )
  const lifetime = options.lifetime ?? defaultLifetime
  const check = (people: readonly DevPerson[]) => (people.length ? peopleSchema.parse(people) : [])
  const given = check(listed)
  const sample = check(options.sample ?? [])
  /** The list this sign-in goes by now, or null for the workspace's own people. */
  const list = async (tx: Queryable): Promise<readonly DevPerson[] | null> => {
    if (given.length) return given
    if (sample.length && (method === 'demo' || (await holdsDemo(tx)))) return sample
    return null
  }
  /** Every listed person is in the database, with the roles the list gives them at first. */
  const initialize = async (tx: Queryable, people: readonly DevPerson[]) => {
    for (const person of people)
      await tx.query('select auth.bootstrap_person($1,$2,$3::global_role[])', [
        person.email,
        person.name,
        person.roles,
      ])
  }
  const auth: SignIn = {
    method,
    lifetime,
    async choices(tx) {
      const people = await list(tx)
      const known = await tx.query<{ id: string; email: string; name: string }>(
        `select id::text, email, display_name as name from people
          where ${active} and ($1::text[] is null or email = any($1)) order by created_at, id`,
        [people?.map((p) => p.email) ?? null],
      )
      const ids = known.map((p) => p.id)
      const roles = await tx.query<{ personId: string; role: DevPerson['roles'][number] }>(
        'select person_id::text as "personId", role from global_role_grants where person_id = any($1::uuid[]) and valid_at @> now() order by role',
        [ids],
      )
      const assignments = await tx.query<{
        personId: string
        role: SignInPerson['assignments'][number]['role']
        id: string
        name: string
        label: SignInPerson['assignments'][number]['area']['label']
      }>(
        `select g.person_id::text as "personId", g.role, a.id, a.name, a.label
           from area_assignments g join areas a on a.id = g.area_id
          where g.person_id = any($1::uuid[]) and g.valid_at @> now()
          order by a.name, g.role`,
        [ids],
      )
      // A list keeps its order and shows who has not signed in yet; a workspace shows who is in it.
      const offered: (DevPerson & { id?: string })[] =
        people?.map((person) => {
          const row = known.find((p) => p.email === person.email)
          return { ...person, name: row?.name ?? person.name, ...(row ? { id: row.id } : {}) }
        }) ?? known.map((row) => ({ ...row, roles: [] }))
      return offered.map(({ id, email, name, roles: listedRoles }) => ({
        email,
        name,
        initials: initialsOf(name),
        roles: id ? roles.filter((r) => r.personId === id).map((r) => r.role) : listedRoles,
        assignments: id
          ? assignments
              .filter((a) => a.personId === id)
              .map(({ role, id, name, label }) => ({ role, area: { id, name, label } }))
          : [],
      }))
    },
    async first(tx) {
      if (await list(tx)) return false
      const [row] = await tx.query<{ nobody: boolean }>(
        'select not exists (select 1 from people) as nobody',
      )
      return row!.nobody
    },
    async setUp(tx, person, cookie) {
      if (await list(tx)) return null
      const [row] = await tx.query<{ id: string | null }>(
        'select auth.first_person($1,$2)::text as id',
        [person.email, person.name],
      )
      const made = row?.id ? await principalFor(tx, row.id) : null
      return made ? startSession(tx, made, method, lifetime, cookie) : null
    },
    currentSession: (tx, cookie) => currentSession(tx, cookie, lifetime),
    async signIn(tx, email, cookie) {
      const people = await list(tx)
      if (people) {
        if (!people.some((p) => p.email === email)) return null
        await initialize(tx, people)
      }
      const [row] = await tx.query<{ id: string }>(
        `select id::text from people where email=$1 and ${active}`,
        [email],
      )
      if (!row) return null
      const person = await principalFor(tx, row.id)
      if (!person) return null
      return startSession(tx, person, method, lifetime, cookie)
    },
    signOut: endSession,
    groups: () => Promise.resolve([]),
  }
  return auth
}
