/*
  What the landing page's first screen shows: four questions about the demo company that comes
  with Footnote, each with the answer line get_context gives it on the demo and the notes it reads
  (docs/design/demo-world.md, sections 11 and 14). Titles, quotes, sources, names and dates are the
  demo's own, and test/landing.test.ts holds them to db/seed and the demo's design word for word.
  Each line is the one get_context gave on a fresh install of the demo on 26 Nov 2026: Germany's
  is Outdated, because its note's check date, 6 Sep 2026, has passed. The window around them is
  drawn: it is an example of an agent's answer, and its caption says so.
*/

export type Line = 'checked' | 'stale' | 'conflict' | 'missing'

/** A person beside a note: their initials and colour, or a domain's square when there is none. */
export type Who = {
  face?: { initials: string; color: string }
  lead: string
  name: string
  tail?: string
}

export type Note = {
  title: string
  scope?: readonly string[]
  quote?: { text: string; source: string }
  who: readonly Who[]
  /** The day its check date passed, when it has. */
  due?: string
  dont?: string
}

/** A sentence of the answer, with the number of the note it came from. */
export type Said = { text: string; note: number }

export type Answer = {
  key: 'norway' | 'germany' | 'uk' | 'sweden'
  question: string
  line: Line
  /** What an agent says on its own, struck out when Footnote answers. */
  guess?: string
  /** The answer: sentences from notes, or the plain words that nothing is written. */
  says: readonly Said[] | { nothing: string }
  next?: string
  notes: readonly Note[]
}

/** The answer line's words, as Ask shows them (src/domain/answer-state.ts). */
export const lines: Record<Line, { label: string; says: string }> = {
  checked: { label: 'Checked', says: 'This is written down and checked' },
  stale: { label: 'Outdated', says: 'Some of this may be old' },
  conflict: { label: 'Conflict', says: 'Two items say different things' },
  missing: { label: 'Not found', says: 'Nothing published about this yet' },
}

export const answers: readonly Answer[] = [
  {
    key: 'norway',
    question: 'How did orders in Norway change in October 2026?',
    line: 'checked',
    guess: 'This may reflect weaker marketing performance.',
    says: [
      {
        text: 'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.',
        note: 1,
      },
    ],
    notes: [
      {
        title: 'Online sales to Norway stopped on 4 August 2026',
        scope: ['Orders', 'Norway', 'From 4 Aug 2026'],
        quote: {
          text: 'Parcels from webshops outside Norway are held at the border from 4 August 2026 until further notice.',
          source: 'customs.example/norway/notices/2026-08-04',
        },
        who: [
          {
            face: { initials: 'ML', color: '#b4551f' },
            lead: 'Written by ',
            name: 'Maria Lindqvist',
          },
          {
            face: { initials: 'JA', color: '#12746b' },
            lead: 'Checked by ',
            name: 'Jon Abara',
            tail: ', owner of Sales, 3 Oct 2026',
          },
        ],
        dont: 'Fewer orders in Norway after 4 August do not mean fewer customers.',
      },
    ],
  },
  {
    key: 'germany',
    question: "Why are Germany's orders low for yesterday?",
    line: 'stale',
    says: [
      {
        text: "Germany's payment files reach Cube the morning after, so yesterday's orders are always short.",
        note: 1,
      },
    ],
    next: 'Leave out the last day when you compare Germany weeks.',
    notes: [
      {
        title: 'Orders lags by one day in the source tool',
        scope: ['Orders', 'Germany'],
        quote: {
          text: 'Germany payment files are loaded the following morning at 07:00.',
          source: 'wiki.example/data/freshness',
        },
        who: [{ lead: '', name: 'Sales', tail: ', owned by Jon Abara and Sofia Brandt' }],
        due: '6 Sep 2026',
        dont: "A low last day for Germany orders isn't a drop.",
      },
    ],
  },
  {
    key: 'uk',
    question: 'How are orders counted in the United Kingdom?',
    line: 'conflict',
    says: [
      { text: 'One note says they count store credit.', note: 1 },
      { text: 'One says they are card and cash payments only.', note: 2 },
    ],
    next: 'The agent gets both and says so. An owner keeps one, narrows one, or keeps both.',
    notes: [
      {
        title: 'United Kingdom orders count store credit',
        who: [
          {
            face: { initials: 'JA', color: '#12746b' },
            lead: 'Sales. Written by ',
            name: 'Jon Abara',
          },
        ],
      },
      {
        title: 'United Kingdom orders are card and cash payments only',
        who: [
          {
            face: { initials: 'SB', color: '#6d4bc4' },
            lead: 'Sales. Written by ',
            name: 'Sofia Brandt',
          },
        ],
      },
    ],
  },
  {
    key: 'sweden',
    question: 'Why did returns in Sweden jump in March 2023?',
    line: 'missing',
    says: { nothing: 'for Returns in Sweden in March 2023.' },
    next: "That's not the same as there being no reason. The question goes back to the owner as a gap, so it gets written.",
    notes: [],
  },
]

/** What a typed question that matches none of the four gets. */
export const unmatched = {
  says: { nothing: 'about that on this page.' },
  next: 'This page holds four questions from the demo. In Footnote, a question that finds nothing goes back to the owner as a gap, so it gets written.',
} as const
