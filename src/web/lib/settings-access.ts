/** The sections of Settings someone who isn't an admin may open: an owner's domains and people, and everyone's agents. */
export const memberSections = (owner: boolean): readonly string[] =>
  owner ? ['domains', 'people', 'agents'] : ['agents']

/** Where Settings opens for someone who isn't an admin: an owner's domains, else their agents. */
export const landingOf = (owner: boolean) => (owner ? 'domains' : 'agents')
