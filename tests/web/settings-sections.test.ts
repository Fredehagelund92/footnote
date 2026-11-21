// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { settingsSections } from '@/components/settings-nav'
import { settingsSectionIds } from '@/lib/settings-access'

// The settings navigation lists every section of Settings, in the order the sections are named once.

describe('the settings navigation', () => {
  it('lists exactly the sections of Settings, in order', () => {
    expect(settingsSections.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      ...settingsSectionIds,
    ])
  })
})
