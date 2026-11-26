// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { settingsSections } from '@/components/settings-nav'
import { mayOpenSettings, settingsSectionIds } from '@/lib/settings-access'

// The settings navigation lists every section of Settings, in the order the sections are named once.
// A link into Settings is drawn only for someone the section opens for.

describe('the settings navigation', () => {
  it('lists exactly the sections of Settings, in order', () => {
    expect(settingsSections.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      ...settingsSectionIds,
    ])
  })
})

describe('who may open a Settings address', () => {
  const admin = { admin: true, owns: [] }
  const owner = { admin: false, owns: ['sales'] }
  const member = { admin: false, owns: [] }

  it('opens every address to an admin', () => {
    for (const path of [
      '/settings/advanced',
      '/settings/integrations/cube',
      '/settings/domains/new',
    ])
      expect(mayOpenSettings(path, admin)).toBe(true)
  })

  it("opens an owner's domains, people and agents, but no new domain", () => {
    for (const path of [
      '/settings',
      '/settings/domains',
      '/settings/domains/sales',
      '/settings/people',
    ])
      expect(mayOpenSettings(path, owner)).toBe(true)
    for (const path of [
      '/settings/general',
      '/settings/advanced',
      '/settings/integrations/cube?state=suggestions',
      '/settings/domains/new?setup=1',
    ])
      expect(mayOpenSettings(path, owner)).toBe(false)
  })

  it('opens only Agents and access to a member', () => {
    expect(mayOpenSettings('/settings/agents', member)).toBe(true)
    expect(mayOpenSettings('/settings', member)).toBe(true)
    for (const path of ['/settings/domains', '/settings/people', '/settings/integrations'])
      expect(mayOpenSettings(path, member)).toBe(false)
  })

  it('leaves addresses outside Settings to their own pages', () => {
    expect(mayOpenSettings('/inbox?card=x', member)).toBe(true)
  })
})
