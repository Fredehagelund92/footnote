import { describe, expect, it } from 'vitest'
import { familyRead, sourceNames } from '@domain/source-names'
import type { CandidateMember } from '@domain/term-candidates'
import { termWord } from '@domain/terms'
import { createMockNames } from '@/api/mock/names'

// A family goes live with its variants (FR-142), each by its own name: a variant whose name another
// definition holds refuses the family, in words that name no variant. As on the service, only an
// admin or an owner of a name's domain reads it and decides it.

const admin = { admin: true, owns: [] }

describe('who the mock shows the names to', () => {
  it("shows them to an admin and their domain's owners, and to nobody else", async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const all = (await names.read(admin)).names
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((name) => name.areaId === 'sales')).toBe(true)
    expect((await names.read({ admin: false, owns: ['sales'] })).names).toEqual(all)
    for (const who of [
      { admin: false, owns: ['marketing'] },
      { admin: false, owns: [] },
    ]) {
      expect((await names.read(who)).names).toEqual([])
      expect(names.card('Tomas Eriksen', who)).toBeNull()
    }
  })

  it('refuses a decision from someone the names are not shown to', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { names: shown } = await names.read(admin)
    const outsider = { admin: false, owns: ['marketing'] }
    const { revision } = await names.read(outsider)
    for (const input of [
      { accept: [{ key: shown[0]!.key }], leaveOut: [] },
      { accept: [], leaveOut: [shown[0]!.key] },
    ]) {
      const refusal = await names.decide({ revision, ...input }, outsider).catch((e: Error) => e)
      expect(refusal).toBeInstanceOf(Error)
      expect((refusal as Error).message).toBe(
        'A name here is no longer waiting. Look at the latest list, then try again.',
      )
    }
  })
})

describe('the mock refusing a family whose variant has a taken name', () => {
  it('refuses it without naming the variant, as the service does', async () => {
    const taken = new Map([
      [
        termWord('Packaging costs (EUR) web'),
        [{ origin: 'vocabulary' as const, ref: 'metric:turnover', name: 'Turnover' }],
      ],
    ])
    const names = createMockNames(taken)
    names.load(true)
    const { revision, names: shown } = await names.read(admin)
    const family = shown.find((name) => name.name === 'Packaging costs')!
    expect(family.flags.map((flag) => flag.code)).toEqual(['variants'])
    const refusal = await names
      .decide({ revision, accept: [{ key: family.key }], leaveOut: [] }, admin)
      .catch((error: Error) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toContain('A variant of “Packaging costs”')
    expect((refusal as Error).message).not.toMatch(/\(EUR\)|Turnover/)
  })
})

describe('the other ways the mock finds a family (D1)', () => {
  it('marks a declared family and one found from a rate, both ready', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { names: shown } = await names.read(admin)
    const said = (name: string) => shown.find((n) => n.name === name)
    expect(said('Gift wrap')).toMatchObject({
      state: 'ready',
      family: { variants: 2, by: ['Sales line'], found: 'declared', names: [] },
    })
    expect(said('Accrued share')).toMatchObject({
      state: 'ready',
      family: { variants: 2, by: ['Currency'], found: 'rate', names: [] },
    })
  })

  it('holds names that only look alike for the owner, and publishes them apart', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read(admin)
    const alike = shown.find((n) => n.name === 'Shipping fee')!
    expect(alike).toMatchObject({
      state: 'flagged',
      flags: [{ code: 'look_alike' }],
      family: { found: 'names', names: ['Shipping fee (EUR)', 'Shipping fee (USD)'] },
    })
    const decided = await names.decide(
      {
        revision,
        accept: [{ key: alike.key, apart: true }],
        leaveOut: [],
      },
      admin,
    )
    expect(decided.accepted).toBe(2)
    const after = decided.waiting.names.map((n) => n.name)
    expect(after).not.toContain('Shipping fee')
    expect(after).not.toContain('Shipping fee (EUR)')
  })
})

describe('a suggested family on the Names card (F4)', () => {
  it('says the values its variants hold and what it would mean', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { names: shown } = await names.read(admin)
    const packaging = shown.find((n) => n.name === 'Packaging costs')!
    expect(packaging.family).toMatchObject({
      by: ['Currency', 'Channel'],
      values: [
        ['EUR', 'GBP', 'SEK', 'USD'],
        ['app', 'web'],
      ],
      meaning: {
        source: 'common',
        words: 'What boxes, fill and labels cost for orders in {Currency} via {Channel}.',
        agree: 8,
        differing: 0,
      },
    })
  })

  it('keeps the variants of a family found from the calculation separate', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read(admin)
    const packaging = shown.find((n) => n.name === 'Packaging costs')!
    const decided = await names.decide(
      {
        revision,
        accept: [{ key: packaging.key, apart: true }],
        leaveOut: [],
      },
      admin,
    )
    expect(decided.accepted).toBe(8)
    const after = decided.waiting.names.map((n) => n.name)
    expect(after).not.toContain('Packaging costs')
    expect(after.filter((name) => name.startsWith('Packaging costs'))).toEqual([])
  })
})

describe('the mock refusing what the service refuses', () => {
  it('refuses to keep the variants of a family its tool declares separate', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read(admin)
    const declared = shown.find((n) => n.name === 'Gift wrap')!
    const refusal = await names
      .decide({ revision, accept: [{ key: declared.key, apart: true }], leaveOut: [] }, admin)
      .catch((error: Error) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toContain('declares')
  })

  it('refuses to keep apart a name that is no family', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read(admin)
    const plain = shown.find((n) => n.name === 'Completed orders')!
    const refusal = await names
      .decide({ revision, accept: [{ key: plain.key, apart: true }], leaveOut: [] }, admin)
      .catch((error: Error) => error)
    expect(refusal).toBeInstanceOf(Error)
  })

  it('refuses a name both published and left out, apart or not', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read(admin)
    const alike = shown.find((n) => n.name === 'Shipping fee')!
    const refusal = await names
      .decide({ revision, accept: [{ key: alike.key, apart: true }], leaveOut: [alike.key] }, admin)
      .catch((error: Error) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toContain('not both')
  })
})

describe('what a converted pair would mean on the Names card', () => {
  const pair = (code: 'EUR' | 'USD'): CandidateMember => ({
    ref: `dbt:orders.accrued_share_${code.toLowerCase()}`,
    source: 'dbt',
    kind: 'metric',
    name: `orders.accrued_share_${code.toLowerCase()}`,
    title: `Accrued share (${code})`,
    description: code === 'EUR' ? 'What partners earned, in euros.' : null,
    valueType: 'sum',
    areaHint: 'sales',
    synonyms: [],
    baseName: null,
    mergeDimensions: 'never',
    builtFrom: {
      refs: [],
      columns: code === 'EUR' ? ['accrued_share_eur'] : ['accrued_share_eur', 'exchange_rate_usd'],
    },
  })

  it('reads the words of the variant the others are converted from, its currency a slot', () => {
    const family = sourceNames([pair('EUR'), pair('USD')], [], new Map(), new Set()).find(
      (name) => name.kind === 'metric_group',
    )!
    expect(family.family!.meaning).toMatchObject({
      source: 'common',
      words: 'What partners earned, in {Currency}.',
      base: 'metric:accrued_share_eur',
    })
  })

  it('carries the base variant to the card as the card shows variants', () => {
    const family = sourceNames([pair('EUR'), pair('USD')], [], new Map(), new Set()).find(
      (name) => name.kind === 'metric_group',
    )!
    expect(familyRead(family)!.meaning).toMatchObject({
      source: 'common',
      agree: 1,
      base: 'Accrued share (EUR)',
    })
  })
})
