/** Every section of Settings, in the order the settings navigation lists them. */
export const settingsSectionIds = [
  'general',
  'domains',
  'people',
  'agents',
  'integrations',
  'advanced',
] as const

/** The sections of Settings someone who isn't an admin may open: an owner's domains and people, and everyone's agents. */
export const memberSections = (owner: boolean): readonly string[] =>
  owner ? ['domains', 'people', 'agents'] : ['agents']

/** Where Settings opens for someone who isn't an admin: an owner's domains, else their agents. */
export const landingOf = (owner: boolean) => (owner ? 'domains' : 'agents')
