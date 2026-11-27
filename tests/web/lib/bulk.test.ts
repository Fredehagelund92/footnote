import { describe, expect, it } from 'vitest'
import { facts as seed } from '@/api/mock/data/world'
import { ownersOf } from '@/model/people'
import { servedToAgents, type Fact } from '@/model/items'
import { historyOf } from '@/api/mock/data/history'
import { createMockApi } from '@/api/mock'
import { createDefinitions } from '@/api/mock/definitions'
import { createWorkspace } from '@/api/mock/workspace'
import { findDefinition, goesWith } from '@/lib/definitions'
import {
  canChange,
  askDelete,
  CONFIRM_ABOVE,
  doneLine,
  draftReadiness,
  heldRows,
  movableTo,
  needsTyping,
  planFacts,
  planTerms,
  PUBLISH_MAX,
  publishedLine,
  publishesNow,
  publishParts,
  skippedLine,
  toCsv,
  toMarkdown,
  TYPE_ABOVE,
} from '@/lib/bulk'
import { leftOutLine, nextLine, nothingToPublish, publishedWhen } from '@/lib/publish-lines'
import { reduce, start } from '@/api/mock/store'
import type { LogEntry } from '@/model/items'

// A change to many items, before it happens: what it acts on, what it leaves alone and why. Owners
// of an item's domain and admins change it; drafts are deleted, published items archived.

const fact = (id: string) => seed.find((f) => f.id === id)!
const domains = createWorkspace().domainMap()
const jon = { name: 'Jon Abara', admin: true }
const tomas = { name: 'Tomas Eriksen', admin: false }
const sofia = { name: 'Sofia Brandt', admin: false }
const salesLive = seed.filter((f) => f.domain === 'sales' && f.status === 'Live').slice(0, 2)
const marketingLive = seed
  .filter((f) => f.domain === 'marketing' && f.status === 'Live')
  .slice(0, 2)
const drafts = seed.filter((f) => f.status === 'Draft')

describe('who changes what', () => {
  it("lets owners of the item's domain and admins change it", () => {
    expect(canChange(salesLive[0]!, sofia, domains)).toBe(true)
    expect(canChange(salesLive[0]!, tomas, domains)).toBe(false)
    expect(canChange(salesLive[0]!, jon, domains)).toBe(true)
  })

  it("skips the items someone can't change, and says whose they are", () => {
    const plan = planFacts('archive', [...salesLive, ...marketingLive], sofia, domains)
    expect(plan.act).toEqual(salesLive)
    expect(plan.skipped.map((s) => s.why)).toEqual(['owned by Marketing', 'owned by Marketing'])
    expect(skippedLine(plan.skipped)).toBe('2 skipped: owned by Marketing')
    expect(plan.skipped[0]!.reason).toBe('Only owners of Marketing and admins can change it.')
  })

  it('moves items only into domains the person owns, unless they are an admin', () => {
    expect(movableTo(tomas, domains)).toEqual(['marketing'])
    expect(movableTo(jon, domains)).toHaveLength(5)
  })
})

describe('archive and delete', () => {
  it('deletes drafts only: published items are archived, not deleted', () => {
    const plan = planFacts('delete', [...drafts, salesLive[0]!], jon, domains)
    expect(plan.act).toEqual(drafts)
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        id: salesLive[0]!.id,
        why: 'published',
        reason: 'Published items are archived, not deleted.',
      }),
    ])
  })

  it('archives published items, and leaves drafts and archived ones alone', () => {
    const archived = seed.find((f) => f.status === 'Archived')!
    const plan = planFacts('archive', [salesLive[0]!, drafts[0]!, archived], jon, domains)
    expect(plan.act).toEqual([salesLive[0]!])
    expect(skippedLine(plan.skipped)).toBe('2 skipped: 1 a draft, 1 already archived')
  })

  it('never serves a draft to agents', () => {
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.some(servedToAgents)).toBe(false)
    expect(servedToAgents(salesLive[0]!)).toBe(true)
  })

  it('asks for the number to be typed only above ten', () => {
    expect(TYPE_ABOVE).toBe(10)
    expect(needsTyping(10)).toBe(false)
    expect(needsTyping(11)).toBe(true)
  })
})

describe('the other changes', () => {
  it('marks as checked only what the person opened, as publishing together does', () => {
    const [a, b] = salesLive as [Fact, Fact]
    const plan = planFacts('check', [a, b, drafts[0]!], jon, domains, { viewed: { [a.id]: true } })
    expect(plan.act).toEqual([a])
    expect(skippedLine(plan.skipped)).toBe('2 skipped: 1 not opened yet, 1 a draft')
  })

  it('skips what is already so', () => {
    const f = salesLive[0]!
    expect(planFacts('domain', [f], jon, domains, { domain: 'sales' }).skipped[0]!.why).toBe(
      'already in Sales',
    )
    expect(planFacts('kind', [f], jon, domains, { kind: f.kind }).act).toEqual([])
  })

  it('gives an item owners only who can change it', () => {
    const plan = planFacts('owner-add', [salesLive[0]!, marketingLive[0]!], jon, domains, {
      person: sofia,
    })
    expect(plan.act).toEqual([])
    expect(plan.skipped.map((s) => s.why)).toEqual([
      'already an owner',
      "Sofia Brandt doesn't own Marketing",
    ])
    // An admin can answer for any item.
    expect(planFacts('owner-add', [marketingLive[0]!], jon, domains, { person: jon }).act).toEqual([
      marketingLive[0]!,
    ])
    expect(
      ownersOf({ ...marketingLive[0]!, owners: ['Tomas Eriksen', 'Jon Abara'] }, domains),
    ).toEqual(['Tomas Eriksen', 'Jon Abara'])
    expect(ownersOf(marketingLive[0]!, domains)).toEqual(['Tomas Eriksen'])
  })
})

describe('what the bar says', () => {
  it('counts what was done, and what failed', () => {
    expect(doneLine('archived', 4, 0)).toBe('4 archived')
    expect(doneLine('archived', 3, 1)).toBe('3 of 4 archived, 1 failed')
  })

  it('fails a first try on its last row only when the address asks, so a retry goes through', async () => {
    const { api, controls } = createMockApi()
    controls.setAddress({ path: '/context', query: { bulk: 'fail' } })
    const entry: LogEntry = {
      id: 'log-x',
      on: '2026-10-23',
      who: 'Jon Abara',
      what: 'archived',
      summary: 'Archived.',
      items: salesLive.map((f) => ({ id: f.id, title: f.title })),
    }
    const patches = Object.fromEntries(
      salesLive.map((f) => [f.id, { status: 'Archived' as const }]),
    )
    const first = await api.applyBulk({ action: 'archive', patches, remove: [], entry })
    expect(first.done).toEqual([salesLive[0]!.id])
    expect(first.failed).toEqual([salesLive[1]!.id])
    const retry = await api.applyBulk({
      action: 'archive',
      patches: { [salesLive[1]!.id]: { status: 'Archived' } },
      remove: [],
      entry: { ...entry, id: 'log-y' },
    })
    expect(retry).toEqual(expect.objectContaining({ done: [salesLive[1]!.id], failed: [] }))
  })
})

describe('terms', () => {
  it('changes terms only: synced metrics and dimensions are left alone with their tool', () => {
    const all = createDefinitions().list()
    const webshop = findDefinition(all, 'Webshop')!
    const orders = findDefinition(all, 'Orders')!
    const plan = planTerms('delete', [webshop, orders], jon, domains)
    expect(plan.act).toEqual([webshop])
    expect(plan.skipped[0]!).toEqual(expect.objectContaining({ why: 'read from Cube' }))
    expect(planTerms('delete', [webshop], tomas, domains).skipped[0]!.why).toBe('owned by Sales')
  })

  it('refuses to delete a family: one Footnote found is split on its page, a declared one changed in its tool', () => {
    const definitions = createDefinitions()
    definitions.loadFamilies()
    const all = definitions.list()
    // Names that look alike, published as one family: there is nothing in dbt to change (S5).
    const fees = findDefinition(all, 'Partner fees')!
    const buyers = findDefinition(all, 'Active buyers')!
    expect(planTerms('delete', [fees], sofia, domains).skipped).toEqual([
      expect.objectContaining({
        why: 'a family',
        reason: "A family isn't deleted: split it on its page, and each of its metrics stays.",
      }),
    ])
    expect(planTerms('delete', [fees], tomas, domains).skipped[0]!.reason).toBe(
      "A family isn't deleted: owners of Sales can split it on its page, and each of its metrics stays.",
    )
    expect(planTerms('delete', [buyers], sofia, domains).skipped).toEqual([
      expect.objectContaining({
        why: 'declared in dbt',
        reason: 'dbt declares it as one family: change it there.',
      }),
    ])
  })

  it("takes a term's synonyms with it, and Undo brings all of them back", () => {
    const definitions = createDefinitions()
    const before = definitions.list()
    const target = before.find((d) => !d.synced && !d.sameAs && goesWith(before, [d.name]).length)
    if (!target) return
    const synonyms = goesWith(before, [target.name]).map((d) => d.name)
    const undo = definitions.deleteTerms([target.name])
    expect(findDefinition(definitions.list(), target.name)).toBeUndefined()
    for (const s of synonyms) expect(findDefinition(definitions.list(), s)).toBeUndefined()
    undo()
    expect(definitions.list()).toBe(before)
  })
})

describe('the delete confirmation', () => {
  // Jon ticks a metric synced from Cube and presses Delete: nothing can be deleted, so nothing opens.
  const all = createDefinitions().list()
  const orders = findDefinition(all, 'Orders')!
  const webshop = findDefinition(all, 'Webshop')!
  const reasonFor = (ids: string[]) => {
    const plan = planTerms(
      'delete',
      all.filter((d) => ids.includes(d.name)),
      jon,
      domains,
    )
    return plan.act.length ? undefined : plan.skipped[0]?.reason
  }

  it('opens nothing when nothing in the selection can be deleted, and says why', () => {
    expect(askDelete([orders.name], reasonFor([orders.name]))).toEqual({
      refused: 'Metrics and dimensions are read-only here: change them in Cube.',
    })
  })

  it('opens holding exactly the ids it was asked with', () => {
    const ids = [webshop.name, orders.name]
    const asked = askDelete(ids, reasonFor(ids))
    expect(asked).toEqual({ confirming: { ids } })
    // A copy: ticking or unticking afterwards cannot change what the confirmation holds.
    ids.length = 0
    expect(asked).toEqual({ confirming: { ids: [webshop.name, orders.name] } })
  })

  it('never opens for an empty selection', () => {
    expect(askDelete([])).toEqual({ refused: 'Nothing is ticked.' })
  })

  it('refuses for the reason it is given, such as being offline', () => {
    expect(askDelete([webshop.name], "Off while you're offline. Nothing is lost.")).toEqual({
      refused: "Off while you're offline. Nothing is lost.",
    })
  })

  it('holds the rows it was opened with, however the list changes under it', () => {
    const held = { ids: [webshop.name] }
    const named = (rows: typeof all) => heldRows(rows, held, (d) => d.name).map((d) => d.name)
    expect(named(all)).toEqual([webshop.name])
    // The list refreshes with the row changed: the confirmation shows it as it is now.
    const refreshed = all.map((d) => (d.name === webshop.name ? { ...d, definition: 'new' } : d))
    expect(heldRows(refreshed, held, (d) => d.name)[0]!.definition).toBe('new')
    // The row has gone: it drops out, and the rows ticked since are not added.
    expect(named(all.filter((d) => d.name !== webshop.name))).toEqual([])
    expect(named(all.filter((d) => d.name === orders.name))).toEqual([])
  })

  it('holds nothing while it is shut', () => {
    expect(heldRows(all, null, (d) => d.name)).toEqual([])
  })
})

describe('export', () => {
  it('writes Markdown a person or an agent can read', () => {
    const md = toMarkdown([salesLive[0]!], domains)
    expect(md).toContain(`## ${salesLive[0]!.title}`)
    expect(md).toContain('- Domain: Sales')
  })

  it('writes a spreadsheet with one row each, quoting commas', () => {
    const csv = toCsv([salesLive[0]!, salesLive[1]!], domains).trim().split('\n')
    expect(csv).toHaveLength(3)
    expect(csv[0]!).toBe(
      'Title,Domain,Kind,Status,Applies to,When,Owners,Checked by,Checked on,Source,What agents should know',
    )
    expect(toCsv([{ ...salesLive[0]!, title: 'A "quoted", title' }], domains)).toContain(
      '"A ""quoted"", title"',
    )
  })
})

describe('the store', () => {
  const entry: LogEntry = {
    id: 'log-1',
    on: '2026-10-23',
    who: 'Jon Abara',
    what: 'archived',
    summary: 'Archived: agents stop getting it.',
    items: [{ id: salesLive[0]!.id, title: salesLive[0]!.title, domain: 'sales' }],
  }

  it('applies a change to many items at once, deletes drafts, and writes History', () => {
    const s = reduce(start, {
      type: 'bulk',
      patches: { [salesLive[0]!.id]: { status: 'Archived' } },
      remove: [drafts[0]!.id],
      entry,
    })
    expect(s.edits[salesLive[0]!.id]).toEqual({ status: 'Archived' })
    expect(s.deleted[drafts[0]!.id]).toBe(true)
    expect(s.log).toEqual([entry])
    expect(historyOf(fact(salesLive[0]!.id), s.log)[0]!).toEqual(
      expect.objectContaining({ kind: 'archived', who: 'Jon Abara', summary: entry.summary }),
    )
  })

  it('undoes exactly that change, and takes its line out of History', () => {
    const s = reduce(start, {
      type: 'bulk',
      patches: { [salesLive[0]!.id]: { status: 'Archived' } },
      remove: [drafts[0]!.id],
      entry,
    })
    const back = reduce(s, {
      type: 'revert',
      before: start,
      cards: [],
      facts: [salesLive[0]!.id, drafts[0]!.id],
      entry: entry.id,
    })
    expect(back.edits).toEqual({})
    expect(back.deleted).toEqual({})
    expect(back.log).toEqual([])
    expect(reduce(s, { type: 'unlog', entry: entry.id }).log).toEqual([])
  })

  it('remembers what was opened, once', () => {
    const s = reduce(start, { type: 'viewedFact', id: 'x' })
    expect(s.viewed).toEqual({ x: true })
    expect(reduce(s, { type: 'viewedFact', id: 'x' })).toBe(s)
  })
})

describe('publishing drafts from the list', () => {
  const ines = { name: 'Ines Duarte', admin: false }
  const ready: Fact = {
    ...fact('itm_draft_black_friday'),
    source: 'https://wiki.example/a',
    quote: 'A sentence.',
  }
  const byInes: Fact = { ...ready, id: 'd_ines', domain: 'marketing', by: 'Ines Duarte' }

  it('publishes the first 50 in the list order and keeps the rest for the next press, not as skipped', () => {
    const many = Array.from({ length: PUBLISH_MAX + 6 }, (_, i) => ({ ...ready, id: `d_${i}` }))
    const plan = planFacts('publish', [salesLive[0]!, ...many], jon, domains)
    expect(plan.act.map((f) => f.id)).toEqual(many.slice(0, PUBLISH_MAX).map((f) => f.id))
    expect(plan.next.map((f) => f.id)).toEqual(many.slice(PUBLISH_MAX).map((f) => f.id))
    expect(skippedLine(plan.skipped)).toBe('1 skipped: published')
    expect(nextLine(plan.next.length)).toBe('6 drafts are still ticked: one Publish takes 50.')
    expect(nextLine(1)).toBe('1 draft is still ticked: one Publish takes 50.')
    // A draft that needs a fix does not take a place in the batch.
    const unready = { ...ready, id: 'd_unready', source: '', quote: '' }
    const mixed = planFacts('publish', [unready, ...many], jon, domains)
    expect(mixed.act).toHaveLength(PUBLISH_MAX)
    expect(mixed.next).toHaveLength(6)
    expect(planFacts('archive', many, jon, domains).next).toEqual([])
  })

  it('says why there is nothing to publish at once, by reason, with what to do next', () => {
    const skip = (why: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${why}${i}`, title: 't', why, reason: 'r' }))
    expect(nothingToPublish(skip('published', 3))).toBe(
      'Nothing to publish: these 3 are published already.',
    )
    expect(nothingToPublish(skip('published', 1))).toBe(
      'Nothing to publish: it is published already.',
    )
    expect(nothingToPublish([...skip('published', 21), ...skip('waiting for review', 4)])).toBe(
      'Nothing to publish: 21 are published, 4 wait for review. Open one to decide it.',
    )
    expect(
      nothingToPublish([
        ...skip('missing a source', 1),
        ...skip('a link to fix', 1),
        ...skip('archived', 1),
      ]),
    ).toBe('Nothing to publish: 2 need a fix first, 1 is archived. Open one to fix it.')
    expect(nothingToPublish(skip('owned by Sales', 2))).toBe(
      'Nothing to publish: 2 are owned by Sales.',
    )
    expect(nothingToPublish(skip('owned by Sales', 1))).toBe(
      'Nothing to publish: it is owned by Sales.',
    )
    expect(nothingToPublish(skip('waiting for review', 1))).toBe(
      'Nothing to publish: it waits for review. Open it to decide it.',
    )
    expect(
      nothingToPublish([
        { id: 'd', title: 't', why: 'missing a source', reason: 'Add a source first.' },
      ]),
    ).toBe('Nothing to publish: add a source first.')
  })

  it('says what a Publish leaves alone as information, published first', () => {
    const skip = (why: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${why}${i}`, title: 't', why, reason: 'r' }))
    expect(leftOutLine([])).toBe('')
    expect(leftOutLine(skip('published', 2))).toBe('2 published items you ticked stay as they are.')
    expect(leftOutLine(skip('published', 1))).toBe('A published item you ticked stays as it is.')
    expect(
      leftOutLine([
        ...skip('published', 21),
        ...skip('missing a source', 1),
        ...skip('waiting for review', 4),
      ]),
    ).toBe(
      '21 published items you ticked stay as they are. 5 more are not in this Publish: 1 needs a fix first, 4 wait for review.',
    )
    expect(leftOutLine(skip('missing a source', 2), 'card')).toBe(
      '2 on the card are not in this Publish: 2 need a fix first.',
    )
  })

  it('publishes only drafts that pass the editor checks, and says what is missing', () => {
    const noSource = { ...ready, id: 'd_nosource', source: '', quote: '' }
    const noQuote = { ...ready, id: 'd_noquote', quote: '' }
    const badLink = { ...ready, id: 'd_link', source: 'wiki page' }
    const long = { ...ready, id: 'd_long', summary: 'word '.repeat(80) }
    const nowhere = { ...ready, id: 'd_nowhere', where: [] }
    const plan = planFacts(
      'publish',
      [ready, noSource, noQuote, badLink, long, nowhere, salesLive[0]!],
      jon,
      domains,
    )
    expect(plan.act).toEqual([ready])
    expect(plan.skipped.map((s) => [s.id, s.why, s.reason])).toEqual([
      ['d_nosource', 'missing a source', 'Add a source first.'],
      [
        'd_noquote',
        'missing a sentence copied from the source',
        'Add a sentence copied from the source first.',
      ],
      ['d_link', 'a link to fix', 'Fix the link in Source first.'],
      [
        'd_long',
        'a first paragraph too long',
        'Shorten the first paragraph to 280 characters first.',
      ],
      ['d_nowhere', 'missing where it applies', 'Add where it applies first.'],
      [salesLive[0]!.id, 'published', 'It is published already.'],
    ])
    expect(draftReadiness(ready, domains)).toEqual({ state: 'ready' })
  })

  it("publishes at once for an owner or an admin, and sends a writer's own draft to the owners", () => {
    expect(publishesNow(ready, sofia, domains)).toBe(true)
    expect(publishesNow(byInes, jon, domains)).toBe(true)
    const mine = planFacts('publish', [byInes, ready], ines, domains)
    expect(mine.act).toEqual([byInes])
    expect(publishesNow(byInes, ines, domains)).toBe(false)
    expect(mine.skipped).toEqual([
      {
        id: ready.id,
        title: ready.title,
        why: 'owned by Sales',
        reason: 'Only owners of Sales and admins can change it.',
      },
    ])
    // A writer deletes their own draft too, wherever it is.
    expect(planFacts('delete', [byInes], ines, domains).act).toEqual([byInes])
  })

  it('sends what the bar and a draft page publish alike: patches for its domains, ids for the owners', () => {
    const plan = planFacts('publish', [ready, byInes], ines, domains)
    expect(publishParts(plan, ines, domains, '23 Nov 2026')).toEqual({
      patches: {},
      suggest: ['d_ines'],
      to: 'Marketing',
    })
    const both = planFacts('publish', [ready, byInes], jon, domains)
    expect(publishParts(both, jon, domains, '23 Nov 2026')).toEqual({
      patches: {
        [ready.id]: { status: 'Live', checkedBy: 'Jon Abara', checkedOn: '23 Nov 2026' },
        d_ines: { status: 'Live', checkedBy: 'Jon Abara', checkedOn: '23 Nov 2026' },
      },
      suggest: [],
      to: '',
    })
  })

  it('says what it published and what it sent, and holds a sensible batch', () => {
    expect(publishedLine(3, 0)).toBe('3 published')
    expect(publishedLine(2, 1, 0, 'Marketing')).toBe(
      '2 published, 1 sent to the owners of Marketing',
    )
    expect(publishedLine(0, 0, 2)).toBe('None published, 2 failed')
    // Drafts an earlier press took are published already, never failures.
    expect(publishedLine(0, 0, 0, '', 50)).toBe('50 already published')
    expect(publishedLine(2, 0, 0, '', 3)).toBe('2 published, 3 already published')
    expect(publishedLine(0, 0, 1, '', 3)).toBe('3 already published, 1 failed')
    // One is "it", as on a draft's own page.
    expect(publishedWhen(1)).toBe('Agents get it from the next question.')
    expect(publishedWhen(3)).toBe('Agents get them from the next question.')
    expect(publishedWhen(0, 1)).toBe('Agents get it once an owner publishes it.')
    expect(publishedWhen(0, 2)).toBe('Agents get them once an owner publishes them.')
    expect(CONFIRM_ABOVE).toBe(5)
    expect(PUBLISH_MAX).toBe(50)
  })

  it('publishes a draft through the mock as the service would: it is live, the rest wait', async () => {
    const { api } = createMockApi()
    const draftIds = drafts.map((d) => d.id)
    const result = await api.applyBulk({
      action: 'publish',
      patches: { itm_draft_black_friday: { status: 'Live' } },
      remove: [],
      suggest: ['itm_draft_spring_spend'],
      entry: {
        id: 'log-publish',
        on: '2026-10-23',
        who: 'Jon Abara',
        what: 'published',
        summary: 'Published from the Context list.',
        items: [{ id: 'itm_draft_black_friday', title: 'Black Friday' }],
      },
    })
    expect(result.done.sort()).toEqual(['itm_draft_black_friday', 'itm_draft_spring_spend'])
    const page = await api.contextPage()
    expect(page.find((f) => f.id === 'itm_draft_black_friday')?.status).toBe('Live')
    expect(page.some((f) => f.id === 'itm_draft_spring_spend')).toBe(false)
    expect(draftIds).toContain('itm_draft_spring_spend')
  })
})
