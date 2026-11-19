import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// The design contract on Observability's pages (S14 of the Observability audit): a choice of a
// view is a TextSwitch, never line tabs or a segmented track (design-contract.md, switches).

const dir = join(import.meta.dirname, '../../src/web/pages/observability')

it('has no tablist under pages/observability', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
  expect(files.length).toBeGreaterThan(4)
  for (const f of files)
    expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/role="tab(list)?"/)
})
