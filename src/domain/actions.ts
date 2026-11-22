/*
  The quick actions: the things a person can do in the app that a help part or a read can offer,
  each by one id. A help page's section names the one it explains (`does:` in its front matter,
  docs/help/README.md), so the help that tells a person how to do something can offer to open it.
  Pure: ids only.
*/

export const actionIds = [
  'write_context',
  'add_definition',
  'invite_people',
  'connect_agent',
  'connect_source',
  'publish_names',
  'pick_usual_variant',
  'family_meaning',
  'decide_conflict',
  'open_domain',
  'about_business',
  'add_domain',
] as const
export type ActionId = (typeof actionIds)[number]
