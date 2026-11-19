import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { settingSchemas } from '../../src/contract/admin.ts'
import { ABOUT_BUSINESS_STARTER } from '../../src/domain/about-business.ts'

/*
  About our business starts with no text: the baseline migration writes an empty first version,
  and the setting must accept it as stored. The starter text, which the guide offers and
  Administration's reset puts back, must be one the setting accepts too.
*/

const baseline = readFileSync(
  new URL('../../db/migrations/0001_schema.sql', import.meta.url),
  'utf8',
)

describe('the baseline migration', () => {
  it('starts the setting with no text, as the settings API keeps it', () => {
    const stored = /\('business\.about', 1, '((?:[^']|'')*)'/.exec(baseline)?.[1]
    expect(stored).toBeDefined()
    const value = JSON.parse(stored!.replaceAll("''", "'")) as unknown
    expect(value).toBe('')
    expect(settingSchemas['business.about'].safeParse(value)).toEqual({ success: true, data: '' })
  })
})

describe('the starter text', () => {
  it('is one the setting accepts as it is', () => {
    expect(settingSchemas['business.about'].safeParse(ABOUT_BUSINESS_STARTER)).toEqual({
      success: true,
      data: ABOUT_BUSINESS_STARTER,
    })
  })
})
