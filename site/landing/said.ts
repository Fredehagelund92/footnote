/*
  What the section "What someone already said becomes a note" shows (landing/components/Said.astro):
  a thread in a team chat, the two ways it becomes a person's draft today, and the owner's check.
  It is a demonstration the page plays, and its caption says so. The thread, the Spain story and
  Elena Ruiz are invented for it and are not in the demo; Alex Moreau and Jon Abara are the demo's
  people. The words of the app it shows are the app's own, and test/landing.test.ts holds them to
  it: the first box's button and note, the tool names and status, and the answer line.
  It shows no chat app's own control: Footnote has none, so the person copies the thread.
*/

export type Message = {
  initials: string
  color: string
  name: string
  time: string
  text: string
  /** The reply the person copied. */
  copied?: boolean
}

/** #webshop-spain: a question, the answer to it, and the ask to write it down. */
export const thread = {
  channel: '# webshop-spain',
  messages: [
    {
      initials: 'AM',
      color: '#4f5bd5',
      name: 'Alex Moreau',
      time: '09:12',
      text: 'Orders in Spain jumped on 14 November. Was that the campaign?',
    },
    {
      initials: 'ER',
      color: '#8a5a2b',
      name: 'Elena Ruiz',
      time: '09:20',
      text: 'No, a price error. Every tent showed 50% off in the Spanish webshop from 08:00 to 14:00 on 14 Nov. We kept the orders. wiki.example/incidents/es-price-error',
      copied: true,
    },
    {
      initials: 'AM',
      color: '#4f5bd5',
      name: 'Alex Moreau',
      time: '09:24',
      text: "So it isn't demand. Can someone write it down so the agents stop calling it a campaign?",
    },
  ] satisfies Message[],
  copied: 'Copied: the reply',
}

/** The words the person copied, as they land in the first box or in the agent's chat. */
export const pasted =
  'No, a price error. Every tent showed 50% off in the Spanish webshop from 08:00 to 14:00 on 14 Nov. We kept the orders.'

/** The two ways in that exist today. */
export const doors = [
  { key: 'paste', name: 'Paste it into Footnote', how: 'New context starts with What happened?' },
  { key: 'agent', name: 'Hand it to your agent', how: 'It saves your draft with write_draft' },
] as const

/** The first box of a new item, with no writing help: the app's words (src/web/pages/editor.tsx). */
export const firstBox = {
  page: 'New context',
  question: 'What happened?',
  button: 'Fill it in',
  note: 'Filled in by rule, with no AI model.',
}

/** The agent's door: what the person asks, the tool it calls and what it then says. */
export const agentDoor = {
  ask: 'Make this thread a context item:',
  tool: 'write_draft',
  status: 'draft_saved',
  says: 'I saved it as your draft. Nothing is sent. Check each field, then send it to the owner of Sales.',
}

/** The draft either door leaves: the editor's own fields and button, filled in. */
export const draft = {
  title: 'A price error put every tent at half price in Spain on 14 November 2026',
  fields: [
    { label: 'Kind', chips: ['Event'] },
    { label: 'Applies to', chips: ['Orders', 'Spain'] },
    { label: 'When', chips: ['14 Nov 2026'] },
    { label: 'Source', text: 'wiki.example/incidents/es-price-error' },
    {
      label: "Don't conclude",
      text: 'Higher orders in Spain on 14 November do not mean a campaign worked.',
    },
  ] as readonly { label: string; chips?: readonly string[]; text?: string }[],
  ready: 'Ready',
  send: 'Send to the owner of Sales',
}

/** The owner's check, then the answer in Ask and in an agent. */
export const checked = {
  owner: { initials: 'JA', color: '#12746b', name: 'Jon Abara', role: 'owner of Sales' },
  on: '16 Nov 2026',
  question: 'Why did orders in Spain jump on 14 November 2026?',
  guess: 'This likely reflects a successful campaign.',
  line: 'Checked',
  answer:
    'A price error put every tent at half price in the Spanish webshop for six hours, so orders jumped that day. It was not a campaign.',
  tool: 'get_context',
  say: '1 context item applies to Orders in Spain on 14 November 2026. Nothing else was looked up.',
}

export const caption =
  'A demonstration the page plays, not a recording. The thread, the company and the people are invented. Footnote has no Slack app: you copy the thread.'
