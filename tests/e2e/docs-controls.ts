/*
  The bold controls the docs name (docs/help/README.md, "The docs check"): each with the page that
  names it, the screen it is on, and the way it is drawn there. Plain data, so the docs test (Vitest)
  and the browser check (docs-controls.spec.ts) read the same table. A new bold control in a page
  needs a row here before the docs test passes.
*/

/** How the control is drawn on its screen: a button, a link, a menu or list option, or the words of a row. */
export type Drawn = 'button' | 'link' | 'option' | 'text'

export type DocControl = {
  /** The bold words, as the page writes them. */
  phrase: string
  /** The page that names it, in docs/help. */
  page: string
  /** The app address it is on. */
  at: string
  drawn: Drawn
  /** A button to press first, by its name, when the control is in what it opens. */
  open?: string
}

export const docControls: DocControl[] = [
  { phrase: 'Settings', page: 'connect-an-agent', at: '/inbox', drawn: 'link' },
  { phrase: 'Agents and access', page: 'connect-an-agent', at: '/settings/general', drawn: 'link' },
  { phrase: 'Copy prompt', page: 'connect-an-agent', at: '/settings/agents', drawn: 'button' },
  { phrase: 'Disconnect', page: 'connect-an-agent', at: '/settings/agents', drawn: 'button' },
  { phrase: 'Ask', page: 'ask-a-question', at: '/inbox', drawn: 'link' },
  { phrase: 'Read as', page: 'ask-a-question', at: '/ask?example=grounded', drawn: 'text' },
  { phrase: 'Change', page: 'ask-a-question', at: '/ask?example=grounded', drawn: 'button' },
  { phrase: 'New chat', page: 'ask-a-question', at: '/ask', drawn: 'button' },
  { phrase: 'History', page: 'ask-a-question', at: '/ask', drawn: 'button' },
  {
    phrase: 'Still true',
    page: 'keep-context-up-to-date',
    at: '/inbox?card=check-returns',
    drawn: 'button',
  },
  {
    phrase: 'Edit',
    page: 'keep-context-up-to-date',
    at: '/inbox?card=check-returns',
    drawn: 'button',
  },
  {
    phrase: 'Archive',
    page: 'keep-context-up-to-date',
    at: '/inbox?card=check-returns',
    drawn: 'button',
  },
  {
    phrase: 'Ask someone who knows',
    page: 'keep-context-up-to-date',
    at: '/inbox?card=check-returns',
    drawn: 'button',
  },
  {
    phrase: 'Ask someone who knows',
    page: 'when-nothing-is-written-yet',
    at: '/inbox?card=gap-germany',
    drawn: 'button',
  },
  {
    phrase: 'Not a problem',
    page: 'keep-context-up-to-date',
    at: '/inbox?card=flag-germany',
    drawn: 'button',
  },
  {
    phrase: 'Write context',
    page: 'when-nothing-is-written-yet',
    at: '/inbox?card=gap-germany',
    drawn: 'button',
  },
  {
    phrase: 'Not something we write down',
    page: 'when-nothing-is-written-yet',
    at: '/inbox?card=gap-germany',
    drawn: 'button',
  },
  { phrase: 'Observability', page: 'see-what-agents-asked', at: '/inbox', drawn: 'link' },
  {
    phrase: 'Save this view',
    page: 'see-what-agents-asked',
    at: '/observability',
    drawn: 'button',
  },
  {
    phrase: 'Add a question',
    page: 'see-what-agents-asked',
    at: '/observability/quality',
    drawn: 'button',
  },
  {
    phrase: 'Run now',
    page: 'see-what-agents-asked',
    at: '/observability/quality',
    drawn: 'button',
  },
  { phrase: 'Settings', page: 'publish-without-review', at: '/inbox', drawn: 'link' },
  {
    phrase: 'Agents and access',
    page: 'publish-without-review',
    at: '/settings/general',
    drawn: 'link',
  },
  {
    phrase: 'Let owners choose agents that publish without review',
    page: 'publish-without-review',
    at: '/settings/agents',
    drawn: 'text',
    open: 'Show or hide Publish without review',
  },
  {
    phrase: 'Domains and owners',
    page: 'publish-without-review',
    at: '/settings/general',
    drawn: 'link',
  },
  {
    phrase: 'Let an agent publish without review',
    page: 'publish-without-review',
    at: '/settings/domains/sales?autopublish=on',
    drawn: 'button',
  },
  {
    phrase: 'Let it publish',
    page: 'publish-without-review',
    at: '/settings/domains/sales?autopublish=on',
    drawn: 'button',
    open: 'Let an agent publish without review',
  },
  ...[
    'Publish your names',
    'Ask about a number you know',
    'Write what you know, and ask again',
    'Ask your own agent',
  ].map((phrase): DocControl => ({
    phrase,
    page: 'set-up-your-workspace',
    at: '/inbox?demo=setup',
    drawn: 'text',
  })),
  {
    phrase: 'Domain',
    page: 'set-up-your-workspace',
    at: '/inbox?demo=setup&card=names:waiting',
    drawn: 'text',
  },
  {
    phrase: 'Publish all',
    page: 'set-up-your-workspace',
    at: '/inbox?demo=names',
    drawn: 'button',
  },
  {
    phrase: 'Look at these first',
    page: 'set-up-your-workspace',
    at: '/inbox?demo=names&card=names:waiting&show=names',
    drawn: 'text',
  },
  {
    phrase: 'Publish these as suggested',
    page: 'set-up-your-workspace',
    at: '/inbox?demo=names',
    drawn: 'button',
  },
  { phrase: 'Left out', page: 'set-up-your-workspace', at: '/inbox?demo=names', drawn: 'text' },
  { phrase: 'Settings', page: 'domains-and-owners', at: '/inbox', drawn: 'link' },
  {
    phrase: 'Domains and owners',
    page: 'domains-and-owners',
    at: '/settings/general',
    drawn: 'link',
  },
  { phrase: 'Add a domain', page: 'domains-and-owners', at: '/settings/domains', drawn: 'text' },
  {
    phrase: 'Add the domain',
    page: 'domains-and-owners',
    at: '/settings/domains/new',
    drawn: 'button',
  },
  { phrase: 'Invite people', page: 'domains-and-owners', at: '/settings/people', drawn: 'button' },
  { phrase: 'Context', page: 'write-context', at: '/inbox', drawn: 'link' },
  { phrase: 'Write context', page: 'write-context', at: '/context', drawn: 'button' },
  { phrase: 'Settings', page: 'write-context', at: '/inbox', drawn: 'link' },
  { phrase: 'General', page: 'write-context', at: '/settings/agents', drawn: 'link' },
  { phrase: 'Save as draft', page: 'write-context', at: '/context/new', drawn: 'button' },
  { phrase: 'Advanced', page: 'write-context', at: '/settings/agents', drawn: 'link' },
  { phrase: 'Event', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
  { phrase: 'Warning', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
  { phrase: 'Rule', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
  { phrase: 'Guide', page: 'write-context', at: '/context/new', drawn: 'option', open: 'Kind' },
  {
    phrase: 'Write a first version for me',
    page: 'write-context',
    at: '/settings/general?demo=setup',
    drawn: 'button',
  },
  {
    phrase: 'Keep it',
    page: 'write-context',
    at: '/settings/general?demo=setup',
    drawn: 'button',
    open: 'Write a first version for me',
  },
  {
    phrase: 'Discard',
    page: 'write-context',
    at: '/settings/general?demo=setup',
    drawn: 'button',
    open: 'Write a first version for me',
  },
  {
    phrase: 'Start from the guide',
    page: 'write-context',
    at: '/settings/general?demo=setup',
    drawn: 'button',
  },
  { phrase: 'Settings', page: 'integrations', at: '/inbox', drawn: 'link' },
  { phrase: 'Integrations', page: 'integrations', at: '/settings/general', drawn: 'link' },
  { phrase: 'Connect', page: 'integrations', at: '/settings/integrations', drawn: 'link' },
  {
    phrase: 'Test connection',
    page: 'integrations',
    at: '/settings/integrations/git-markdown/connect?step=2',
    drawn: 'button',
  },
  {
    phrase: 'Change settings',
    page: 'integrations',
    at: '/settings/integrations/cube',
    drawn: 'button',
  },
  {
    phrase: 'Choose views',
    page: 'integrations',
    at: '/settings/integrations/cube',
    drawn: 'button',
  },
  {
    phrase: 'Disconnect',
    page: 'integrations',
    at: '/settings/integrations/cube',
    drawn: 'button',
  },
  {
    phrase: 'Turn off',
    page: 'integrations',
    at: '/settings/integrations/cube',
    drawn: 'button',
  },
  { phrase: 'Conflict', page: 'decide-a-conflict', at: '/context?show=conflicts', drawn: 'text' },
  {
    phrase: 'Keep this one',
    page: 'decide-a-conflict',
    at: '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
    drawn: 'button',
  },
  {
    phrase: 'Edit this one',
    page: 'decide-a-conflict',
    at: '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
    drawn: 'button',
  },
  {
    phrase: 'Keep both',
    page: 'decide-a-conflict',
    at: '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
    drawn: 'button',
  },
  {
    phrase: 'Not a conflict',
    page: 'decide-a-conflict',
    at: '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
    drawn: 'button',
  },
  {
    phrase: 'Ask the owner',
    page: 'decide-a-conflict',
    at: '/context/conflicts/itm_gift_card_only.itm_gift_store_credit',
    drawn: 'button',
  },
  { phrase: 'Definitions', page: 'definitions-and-synonyms', at: '/inbox', drawn: 'link' },
  { phrase: 'New term', page: 'definitions-and-synonyms', at: '/definitions', drawn: 'button' },
  {
    phrase: 'Add a value',
    page: 'definitions-and-synonyms',
    at: '/definitions/Market',
    drawn: 'button',
  },
  {
    phrase: 'Paste a list',
    page: 'definitions-and-synonyms',
    at: '/definitions/Market',
    drawn: 'button',
  },
]
