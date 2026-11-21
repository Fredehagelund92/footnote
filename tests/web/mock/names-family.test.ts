import { describe, expect, it } from 'vitest'
import { termWord } from '@domain/terms'
import { createMockNames } from '@/api/mock/names'

// A family goes live with its variants (FR-142), each by its own name: a variant whose name another
// definition holds refuses the family, in words that name no variant.

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
    const { revision, names: shown } = await names.read()
    const family = shown.find((name) => name.name === 'Packaging costs')!
    expect(family.flags.map((flag) => flag.code)).toEqual(['variants'])
    const refusal = await names
      .decide({ revision, accept: [{ key: family.key }], leaveOut: [] })
      .catch((error: Error) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toContain('A variant of “Packaging costs”')
    expect((refusal as Error).message).not.toMatch(/\(EUR\)|Turnover/)
  })
})

describe('the other ways the mock finds a family (D1)', () => {
  it('marks a declared family and one found from the calculation, both ready', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { names: shown } = await names.read()
    const said = (name: string) => shown.find((n) => n.name === name)
    expect(said('Gift wrap')).toMatchObject({
      state: 'ready',
      family: { variants: 2, by: ['Sales line'], found: 'declared', names: [] },
    })
    expect(said('Accrued share')).toMatchObject({
      state: 'ready',
      family: { variants: 2, by: ['Currency'], found: 'calculation', names: [] },
    })
  })

  it('holds names that only look alike for the owner, and publishes them apart', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read()
    const alike = shown.find((n) => n.name === 'Shipping fee')!
    expect(alike).toMatchObject({
      state: 'flagged',
      flags: [{ code: 'look_alike' }],
      family: { found: 'names', names: ['Shipping fee (EUR)', 'Shipping fee (USD)'] },
    })
    const decided = await names.decide({
      revision,
      accept: [{ key: alike.key, apart: true }],
      leaveOut: [],
    })
    expect(decided.accepted).toBe(2)
    const after = decided.waiting.names.map((n) => n.name)
    expect(after).not.toContain('Shipping fee')
    expect(after).not.toContain('Shipping fee (EUR)')
  })
})

describe('the mock refusing what the service refuses', () => {
  it('refuses a family published apart that is not one of look-alike names', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read()
    const declared = shown.find((n) => n.name === 'Gift wrap')!
    const refusal = await names
      .decide({ revision, accept: [{ key: declared.key, apart: true }], leaveOut: [] })
      .catch((error: Error) => error)
    expect(refusal).toBeInstanceOf(Error)
  })

  it('refuses a name both published and left out, apart or not', async () => {
    const names = createMockNames(new Map())
    names.load(true)
    const { revision, names: shown } = await names.read()
    const alike = shown.find((n) => n.name === 'Shipping fee')!
    const refusal = await names
      .decide({ revision, accept: [{ key: alike.key, apart: true }], leaveOut: [alike.key] })
      .catch((error: Error) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toContain('not both')
  })
})
