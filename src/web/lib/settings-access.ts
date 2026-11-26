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

/** Settings' address for this person: its first section for an admin, else their landing. */
export const settingsHref = (me: { admin: boolean; owns: readonly string[] }) =>
  me.admin ? '/settings' : `/settings/${landingOf(me.owns.length > 0)}`

/**
 * Whether someone may open a Settings address: an admin any, anyone else only the sections that
 * are theirs, where only an admin adds a domain. Settings itself opens for everyone, on their own
 * section, and an address outside Settings is not this rule's.
 */
export function mayOpenSettings(path: string, me: { admin: boolean; owns: readonly string[] }) {
  if (me.admin) return true
  const [, top, section, sub] = path.split(/[?#]/)[0]!.split('/')
  if (top !== 'settings' || !section) return true
  return (
    memberSections(me.owns.length > 0).includes(section) &&
    !(section === 'domains' && sub === 'new')
  )
}
