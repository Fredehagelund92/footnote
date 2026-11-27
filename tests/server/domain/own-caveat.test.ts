import { describe, expect, it } from 'vitest'
import { ownCaveat } from '../../../src/domain/proposal-rules.ts'

describe('what not to conclude, as agents get it', () => {
  it('serves only the words a writer chose', () => {
    expect(ownCaveat("Don't read the drop as demand.")).toBe("Don't read the drop as demand.")
    expect(ownCaveat('  Not legal advice.  ')).toBe('Not legal advice.')
  })

  it('serves nothing for the default, as the service keeps it and as the web app once wrote it', () => {
    for (const text of ['cause not proven', 'Cause not proven.', ' CAUSE NOT PROVEN ', '', null])
      expect(ownCaveat(text)).toBeNull()
    // A longer line that starts the same way is the writer's own.
    expect(ownCaveat('Cause not proven by the survey.')).toBe('Cause not proven by the survey.')
  })
})
