import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  What a stranger checks before trusting the repository: NOTICE names every logo of another
  product the app shows. The NOTICE file and the logos directory are the contract compared.
*/

const root = new URL('../../', import.meta.url)
const notice = readFileSync(new URL('NOTICE', root), 'utf8')

describe('NOTICE', () => {
  it('names every logo in the app', () => {
    const logos = readdirSync(new URL('src/web/assets/logos/', root))
    expect(logos.length).toBeGreaterThan(0)
    for (const logo of logos)
      expect(notice, `NOTICE names ${logo}`).toMatch(new RegExp(`^\\s+${logo}\\s`, 'm'))
  })
})
