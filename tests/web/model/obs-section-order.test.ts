import { expect, it } from 'vitest'
import { sectionsOf, sortGroups, type TopicGroup } from '@/model/observability'
import type { DomainId } from '@/model/items'

const group = (key: string, size: number, domain?: string) =>
  ({
    key,
    name: key,
    domain: domain as DomainId | undefined,
    rows: [{ id: key }],
    counts: {},
    visible: size,
    shown: size,
    months: [],
  }) as unknown as TopicGroup

it('draws a section per domain in domain order, each sorted, with no-domain topics last', () => {
  const groups = sortGroups(
    [group('B', 5, 'marketing'), group('C', 2, 'sales'), group('A', 10, 'sales'), group('N', 99)],
    { key: 'asked', dir: 'desc' },
  )
  const sections = sectionsOf(groups, 'domain', ['sales', 'marketing'] as DomainId[])
  expect(sections.map((s) => [s.domain, s.groups.map((g) => g.key)])).toEqual([
    ['sales', ['A', 'C']],
    ['marketing', ['B']],
    [undefined, ['N']],
  ])
})

it('keeps one section when not grouped by domain', () => {
  const groups = [group('A', 1, 'sales'), group('B', 2)]
  expect(sectionsOf(groups, 'metric', ['sales'] as DomainId[])).toEqual([{ domain: null, groups }])
})
