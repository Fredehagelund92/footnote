import { ORPCError } from '@orpc/client'
import type {
  DecideNames,
  NamesDecision,
  NamesRead,
  SourceNameRead,
  WaitingValue,
} from '../../../contract/inbox.ts'
import { contentDigest } from '../../../domain/canonical.ts'
import { freeAreaId, namesPlace, type NamesPlace } from '../../../domain/names-place.ts'
import {
  familyRead,
  mayGoApart,
  nameRefusal,
  variantNameRefusal,
  sourceNames,
  wordsOf,
  type SourceName,
  type WordHolders,
} from '../../../domain/source-names.ts'
import { memberName } from '../../../domain/term-candidates.ts'
import { termName, termWord } from '../../../domain/terms.ts'
import type { Queryable } from '../../db/database.ts'
import { recordAudit } from '../admin/index.ts'
import { createArea } from '../areas/index.ts'
import { connectorType } from '../connectors/index.ts'
import { lockReleases, publishEdition } from '../editions/index.ts'
import { wordHolders } from '../terms/index.ts'
import { recordTermVersions } from './term-versions.ts'
import { createValuesService } from './values.ts'
import { sourceVocabulary } from './vocabulary.ts'

/*
  The names a read makes, and the one card an owner accepts them with (FR-141, CON-201, CON-206).

  A read stores definitions. Everything people and agents see reads terms, so a member reaches
  them once a term names it and an owner or an administrator accepts it (FR-125). The names are
  worked out from the stored definitions and the live vocabulary each time they are asked for, so
  one can never disagree with the source or with what is live now: a read that adds a metric adds
  its name, one that drops it drops the name, and a domain added later counts at once. The only
  thing kept is which members an owner left out.

  Accepting goes the way every vocabulary change goes: a term version, an accepted proposal, a
  decision by an owner of its domain or an administrator, which the database checks, and an edition,
  which on a new install is the first. All the names of one step are one edition. The read that made
  a name is its only author, so its version names no proposer.

  The values people added in Definitions wait here too (values without figures): each is a
  suggestion of its own, published or left out with the names, in the same edition.
*/

export type NamesView = NamesRead & {
  /** When the newest of the names to look at was first read; null with none. */
  at: string | null
}

/**
 * Maps views of a definitions source to a domain for the reads after (`sources.groups`), with why:
 * the service that keeps sources does it, as Integrations' own mapping does.
 */
export type MapViews = (
  source: string,
  views: readonly string[],
  domain: string,
  reason: string,
) => Promise<void>

/** Why views were mapped, for the history log. */
const MAPPED = 'Mapped with the names published under this domain.'

/** Every member a name links once published: a family's, its variants' too. */
const refsOf = (name: SourceName) => [
  ...name.definitionRefs,
  ...(name.family?.variants.flatMap((variant) => variant.definitionRefs) ?? []),
]

const REASON = 'Accepted the names a read made.'

/** The names as the person read them: any change to what they would decide changes this. */
const revisionOf = (names: readonly SourceNameRead[], values: readonly WaitingValue[]) =>
  contentDigest({
    names: names.map(
      ({ key, name, aliases, definitionRefs, linked, areaId, state, flags, family }) => ({
        key,
        name,
        aliases,
        definitionRefs,
        linked,
        areaId,
        state,
        flags: flags.map((flag) => flag.code),
        family,
      }),
    ),
    values: values.map(({ id, name, aliases, writtenAs }) => ({ id, name, aliases, writtenAs })),
  })

export type NamesService = ReturnType<typeof createNamesService>

export function createNamesService(tx: Queryable) {
  const values = createValuesService(tx)
  /** The domains the person accepts names of, and whether they accept those of no domain too. */
  async function mine() {
    const rows = await tx.query<{ id: string; owned: boolean }>(
      'select a.id, cl_is_owner_now(a.id) as owned from areas a where a.archived_at is null',
    )
    const [me] = await tx.query<{ admin: boolean }>('select cl_is_admin_now() as admin')
    return {
      admin: me?.admin === true,
      active: new Set(rows.map((row) => row.id)),
      owned: new Set(rows.filter((row) => row.owned).map((row) => row.id)),
    }
  }

  async function namesNow() {
    const who = await mine()
    if (!who.admin && !who.owned.size)
      return {
        names: [] as SourceName[],
        tool: (id: string) => id,
        holders: new Map() as WordHolders,
        who,
        hints: new Map<string, { named: string | null; domain: string | null }>(),
      }
    const { members, known } = await sourceVocabulary(tx)
    // Each member's domain as the source names it, and whether that is a domain of this workspace.
    const hints = new Map(
      members.map((member) => [
        member.ref,
        {
          named: member.areaHint,
          domain: member.areaHint && who.active.has(member.areaHint) ? member.areaHint : null,
        },
      ]),
    )
    const live = known.filter((term) => !term.open)
    // A hint never makes a domain (CON-206): one with no domain yet reads as none, for now.
    const mapped = members.map((member) => ({
      ...member,
      areaHint: member.areaHint && who.active.has(member.areaHint) ? member.areaHint : null,
    }))
    const left = await tx.query<{ ref: string }>('select definition_ref as ref from names_left_out')
    const sources = await tx.query<{ id: string; type: string; name: string }>(
      'select id,type,name from connectors',
    )
    const tool = (id: string) => {
      const source = sources.find((s) => s.id === id)
      return source ? connectorType(source.type, source.name).tool : id
    }
    const draft = sourceNames(mapped, live, new Map(), new Set())
    const holders = await wordHolders(tx, [
      ...new Set([...wordsOf(draft), ...members.map((member) => termWord(memberName(member)))]),
    ])
    // A split family keeps its key, to be joined again: a new family takes another.
    const split = await tx.query<{ key: string }>(
      'select distinct family_key as key from family_splits',
    )
    const names = sourceNames(
      mapped,
      live,
      holders,
      new Set(left.map((row) => row.ref)),
      new Set(split.map((row) => row.key)),
    ).filter((name) => who.admin || (name.areaId !== null && who.owned.has(name.areaId)))
    return { names, tool, holders, who, hints }
  }

  /**
   * The names waiting with no domain, which the card offers one for (F08): every member with none
   * of this workspace's. Never a dimension shared by views of several domains (CON-206), whose
   * members each have one.
   */
  const unplacedOf = (
    names: readonly SourceName[],
    hints: ReadonlyMap<string, { named: string | null; domain: string | null }>,
  ) =>
    names.filter(
      (name) =>
        name.state !== 'left_out' &&
        name.areaId === null &&
        refsOf(name).every((ref) => !hints.get(ref)?.domain),
    )

  /** The domains names may go under, and every id a domain has or had. */
  async function domainsNow() {
    const rows = await tx.query<{ id: string; name: string; owned: boolean; open: boolean }>(
      `select id, name, cl_is_owner_now(id) as owned, archived_at is null and not is_demo as open
         from areas`,
    )
    return {
      domains: rows.filter((row) => row.open),
      taken: new Set(rows.map((row) => row.id)),
    }
  }

  /** Where the names with no domain go, for an admin: none for anyone else, who cannot map them. */
  async function placeOf(
    names: readonly SourceName[],
    hints: ReadonlyMap<string, { named: string | null; domain: string | null }>,
    admin: boolean,
  ): Promise<NamesPlace | null> {
    const unplaced = unplacedOf(names, hints)
    if (!admin || !unplaced.length) return null
    return namesPlace({
      unplaced: unplaced.map((name) => {
        const named = refsOf(name).flatMap((ref) => hints.get(ref)?.named ?? [])
        return { named: named[0] ?? null, views: name.views }
      }),
      ...(await domainsNow()),
    })
  }

  const asRead = (name: SourceName, tool: (id: string) => string): SourceNameRead => ({
    key: name.key,
    kind: name.kind,
    name: name.name,
    aliases: name.aliases,
    definitionRefs: name.definitionRefs,
    linked: name.linked,
    areaId: name.areaId,
    description: name.description,
    tool: tool(name.source),
    source: name.source,
    state: name.state,
    flags: name.flags,
    leftByOwner: name.leftByOwner,
    family: familyRead(name),
  })

  /** The names and when the newest was read, or left out when none waits: no digest of the list. */
  async function waiting(now?: Awaited<ReturnType<typeof namesNow>>) {
    const { names, tool } = now ?? (await namesNow())
    const shown = names.map((name) => asRead(name, tool))
    const looking = shown.filter((name) => name.state !== 'left_out')
    const stamp = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`
    const [newest] = looking.length
      ? await tx.query<{ at: string | null }>(
          `select to_char(max(s.fetched_at) at time zone 'UTC',${stamp}) as at
             from definitions d join connector_snapshots s on s.id=d.first_seen_snapshot
            where d.ref=any($1::text[])`,
          [looking.flatMap((name) => name.definitionRefs)],
        )
      : shown.some((name) => name.leftByOwner)
        ? await tx.query<{ at: string | null }>(
            `select to_char(max(left_at) at time zone 'UTC',${stamp}) as at
               from names_left_out where definition_ref=any($1::text[])`,
            [shown.flatMap((name) => name.definitionRefs)],
          )
        : [{ at: null }]
    return { names: shown, at: newest?.at ?? null }
  }

  async function read(): Promise<NamesView> {
    const now = await namesNow()
    const [{ names, at }, waitingValues] = await Promise.all([waiting(now), values.waiting()])
    return {
      revision: await revisionOf(names, waitingValues),
      names,
      values: waitingValues,
      at: [at, ...waitingValues.map((value) => value.at)].reduce<string | null>(
        (newest, when) => (when && (!newest || when > newest) ? when : newest),
        null,
      ),
      place: await placeOf(now.names, now.hints, now.who.admin),
    }
  }

  /** Stores accepted names as terms, versions, accepted proposals and decisions. */
  async function accept(
    picked: readonly (SourceName & { chosen: string })[],
    owned: ReadonlySet<string>,
    tool: (id: string) => string,
  ) {
    const terms = picked.map((name) => ({
      key: name.key,
      kind: name.kind,
      parentKey: name.parentKey ?? null,
      name: name.chosen,
      aliases: name.aliases.filter((alias) => termWord(alias) !== termWord(name.chosen)),
      areaId: name.areaId,
      definitionRefs: name.definitionRefs,
      action: name.linked.length ? ('change' as const) : ('create' as const),
      base: null,
      capacity:
        name.areaId && owned.has(name.areaId) ? ('owner' as const) : ('administrator' as const),
    }))
    await tx.query(
      `insert into vocab_terms(key,kind)
       select e->>'key',(e->>'kind')::term_kind from jsonb_array_elements($1::jsonb) as e
       on conflict (key) do nothing`,
      [JSON.stringify(terms)],
    )
    const tools = [...new Set(picked.map((name) => tool(name.source)))]
    const [batch] = await tx.query<{ id: string }>(
      `insert into import_batches(created_by,mode,source_name,summary)
       values(cl_person(),'apply',$1,$2) returning id::text`,
      [tools.join(', '), JSON.stringify({ subject: 'vocabulary', terms: picked.length })],
    )
    return recordTermVersions(tx, terms, { channel: 'import', reason: REASON, batch: batch!.id })
  }

  /** The domain names are put under: one that exists, or a new one, made and owned by the admin. */
  async function domainFor(
    asked: NonNullable<DecideNames['domain']>,
    admin: boolean,
  ): Promise<string> {
    if (!admin)
      throw new ORPCError('FORBIDDEN', {
        message: 'Only an admin puts names that have no domain under one.',
      })
    const { domains, taken } = await domainsNow()
    if ('id' in asked) {
      if (!domains.some((domain) => domain.id === asked.id))
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          message: 'Names cannot go under that domain. Choose another, or a new one.',
        })
      return asked.id
    }
    const same = domains.find((domain) => domain.name.toLowerCase() === asked.name.toLowerCase())
    if (same) return same.id
    const [me] = await tx.query<{ id: string }>('select cl_person()::text as id')
    const made = await createArea(tx, {
      id: freeAreaId(asked.name, taken),
      name: asked.name,
      chatChannel: null,
      ownerTeam: null,
      summary: '',
      description: '',
      team: { ownerIds: [me!.id] },
    })
    return made.id
  }

  async function decide(input: DecideNames, mapViews?: MapViews): Promise<NamesDecision> {
    await lockReleases(tx)
    const { names, tool, holders, who, hints } = await namesNow()
    const shown = names.map((name) => asRead(name, tool))
    const waitingValues = await values.waiting()
    if ((await revisionOf(shown, waitingValues)) !== input.revision)
      throw new ORPCError('CONFLICT', {
        message:
          'The names changed after you opened them. Look at the latest list, then try again.',
      })
    const byKey = new Map(names.map((name) => [name.key, name]))
    const found = (key: string) => {
      const name = byKey.get(key)
      if (!name)
        throw new ORPCError('CONFLICT', {
          message: 'A name here is no longer waiting. Look at the latest list, then try again.',
        })
      return name
    }
    // A family goes live with its variants, each by its own name, and is left out with them. A
    // family Footnote suggests can go live apart instead (Keep them separate): its variants, and
    // no family. One its tool declares is one there, and one live already keeps its variants.
    const picked = input.accept.flatMap(
      ({ key, name, apart }): (SourceName & { chosen: string })[] => {
        const waiting = found(key)
        if (apart) {
          if (!mayGoApart(waiting))
            throw new ORPCError('UNPROCESSABLE_CONTENT', {
              message:
                waiting.family?.found === 'declared' && !waiting.linked.length
                  ? `${tool(waiting.source)} declares “${waiting.name}” as one family. Keep its variants separate there.`
                  : `“${waiting.name}” is not a family waiting to be published. Publish it as it is.`,
            })
          return waiting.family!.variants.map((variant) => {
            const { parentKey: _parentKey, ...own } = variant
            return { ...own, chosen: variant.name }
          })
        }
        return [
          { ...waiting, chosen: name === undefined ? waiting.name : termName(name) },
          ...(waiting.family?.variants ?? []).map((variant) => ({
            ...variant,
            chosen: variant.name,
          })),
        ]
      },
    )
    const left = input.leaveOut.map(found)
    const live = left.find((name) => name.linked.length)
    if (live)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: `“${live.name}” is live already and gains a view when you publish it. It can't be left out.`,
      })
    const renamed = picked.find((name) => name.linked.length && name.chosen !== name.name)
    if (renamed)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: `“${renamed.name}” is live already. Rename it where it is edited.`,
      })
    const requested = [...input.accept.map(({ key }) => key), ...input.leaveOut]
    if (
      new Set(requested).size !== requested.length ||
      new Set([...picked, ...left].map((name) => name.key)).size !== picked.length + left.length
    )
      throw new ORPCError('CONFLICT', { message: 'Publish a name or leave it out, not both.' })
    const chosen = new Map(
      picked.map((name) => [
        name.key,
        [name.chosen, ...name.aliases.filter((alias) => termWord(alias) !== termWord(name.chosen))],
      ]),
    )
    // A name changed by hand can land on a word nobody read yet.
    const typed = picked.flatMap((name) => {
      const word = termWord(name.chosen)
      return holders.has(word) ? [] : [word]
    })
    const also = typed.length ? await wordHolders(tx, typed) : new Map()
    const known = new Map([...holders, ...also])
    const findings = picked.flatMap((name) => {
      const message = name.linked.length ? null : nameRefusal(name.key, name.chosen, known, chosen)
      if (!message) return []
      const family = name.parentKey ? byKey.get(name.parentKey) : null
      return [
        {
          code: 'word_taken',
          field: family?.key ?? name.key,
          message: family ? variantNameRefusal(family.name) : message,
          severity: 'error' as const,
        },
      ]
    })
    if (findings.length)
      throw new ORPCError('UNPROCESSABLE_CONTENT', {
        message: findings[0]!.message,
        data: { findings },
      })
    // The names published with no domain go under the one asked for (F08), a family's variants
    // with it, and their views are mapped to it for the reads after, unless the tool names it.
    const unplaced = new Set(unplacedOf(names, hints).map((name) => name.key))
    const going = input.accept.flatMap(({ key }) => (unplaced.has(key) ? [found(key)] : []))
    const under = input.domain && going.length ? await domainFor(input.domain, who.admin) : null
    const placed = new Set(
      under
        ? going.flatMap((name) => [name.key, ...(name.family?.variants ?? []).map((v) => v.key)])
        : [],
    )
    const publishing = picked.map((name) =>
      placed.has(name.key) ? { ...name, areaId: under } : name,
    )
    // The names and the values published here are one edition, announced to their one domain.
    const recorded = publishing.length ? await accept(publishing, who.owned, tool) : null
    const decidedValues = await values.decide(input.values)
    const served = [...(recorded?.versions ?? []), ...decidedValues.versions]
    const valueArea = new Map(waitingValues.map((value) => [value.id, value.areaId]))
    const areas = new Set([
      ...publishing.map((name) => name.areaId),
      ...input.values.accept.map((id) => valueArea.get(id) ?? null),
    ])
    const edition = served.length
      ? await publishEdition(
          tx,
          { reason: 'vocabulary_changed', vocabulary: served },
          areas.size === 1 ? [...areas][0]! : null,
        )
      : null
    if (recorded && edition) await recorded.decided(edition.label)
    await decidedValues.decided(edition?.label ?? null)
    if (under && mapViews) {
      const views = new Map<string, Set<string>>()
      for (const name of going) {
        if (refsOf(name).every((ref) => hints.get(ref)?.named === under)) continue
        const of = views.get(name.source) ?? new Set<string>()
        for (const view of name.views) of.add(view)
        views.set(name.source, of)
      }
      for (const [source, of] of views)
        if (of.size) await mapViews(source, [...of].sort(), under, MAPPED)
    }
    await tx.query('delete from names_left_out where definition_ref=any($1::text[])', [
      picked.flatMap((name) => name.definitionRefs),
    ])
    if (left.length) {
      await tx.query(
        `insert into names_left_out(definition_ref)
         select unnest($1::text[]) on conflict (definition_ref) do nothing`,
        [left.flatMap((name) => name.definitionRefs)],
      )
      await recordAudit(tx, {
        action: 'names.left_out',
        subjectType: 'names',
        subjectId: 'waiting',
        details: { names: left.map((name) => name.name) },
      })
    }
    const after = await read()
    return {
      edition: edition?.label ?? null,
      accepted: picked.length,
      leftOut: left.length,
      values: { accepted: decidedValues.versions.length, leftOut: input.values.leaveOut.length },
      waiting: {
        revision: after.revision,
        names: after.names,
        values: after.values,
        place: after.place,
      },
    }
  }

  return { read, waiting, waitingValues: values.waiting, decide }
}
