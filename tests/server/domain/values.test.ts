import { describe, expect, it } from 'vitest'
import { pastedValues, takesValues, valueKeyOf, valuePart } from '../../../src/domain/values.ts'

describe('valueKeyOf', () => {
  it('makes a key from the name, as every key', () => {
    expect(valueKeyOf('dim:market', 'Norway')).toBe('val:market/norway')
    expect(valueKeyOf('dim:market', ' São Paulo ')).toBe('val:market/sao_paulo')
  })

  it('makes the same key for a name in other letters every time, and none for no letters', () => {
    const tokyo = valueKeyOf('dim:market', '東京')
    expect(tokyo).toMatch(/^val:market\/v_[0-9a-f]{8}$/)
    expect(valueKeyOf('dim:market', '東京')).toBe(tokyo)
    expect(valueKeyOf('dim:market', '大阪')).not.toBe(tokyo)
    expect(valueKeyOf('dim:market', '***')).toBeNull()
    expect(valuePart('')).toBe('')
  })
})

describe('pastedValues', () => {
  it('reads one value per line with its other names, once each', () => {
    expect(
      pastedValues('dim:market', 'Norway, Norge\n\nPoland, Polska, EM\nNorway\n***\n'),
    ).toEqual({
      values: [
        { key: 'val:market/norway', name: 'Norway', aliases: ['Norge'], writtenAs: [] },
        { key: 'val:market/poland', name: 'Poland', aliases: ['Polska', 'EM'], writtenAs: [] },
      ],
      unreadable: ['***'],
    })
  })
})

describe('takesValues', () => {
  it('is false for a dimension of dates, numbers or yes and no', () => {
    expect(takesValues(['string'])).toBe(true)
    expect(takesValues([null])).toBe(true)
    expect(takesValues(['categorical', 'string'])).toBe(true)
    expect(takesValues(['time'])).toBe(false)
    expect(takesValues(['string', 'number'])).toBe(false)
    expect(takesValues(['boolean'])).toBe(false)
  })
})
