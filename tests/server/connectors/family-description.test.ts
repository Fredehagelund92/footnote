import { describe, expect, it } from 'vitest'
import { runtimeDefinitionSchema } from '../../../src/domain/connector-runtime.ts'
import { definitionSchema } from '../../../src/server/modules/connectors/types.ts'

// The words a source writes for its family are read as written: a description of only spaces says
// nothing, so a source that sends one is refused rather than read as a declaration.

const by = [{ name: 'currency', ref: null, value: 'EUR' }]
const family = (description?: string) => ({ name: 'revenue', by, description })

describe('a family description a source writes', () => {
  it.each([
    ['the connector interface', runtimeDefinitionSchema.shape.family],
    ['the service', definitionSchema.shape.family],
  ])('is words, not spaces, in %s', (_where, schema) => {
    expect(schema.safeParse(family('Money taken.')).success).toBe(true)
    expect(schema.safeParse(family()).success).toBe(true)
    expect(schema.safeParse(family(' ')).success).toBe(false)
    expect(schema.safeParse(family('\n \t')).success).toBe(false)
  })
})
