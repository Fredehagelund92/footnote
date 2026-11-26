/*
  The landing page's own footnotes: where it got what it says, each in its source's own words.
  The page numbers them in this order (landing/pages/index.astro). Each quote is held word for word
  to its file by test/landing.test.ts, and a page of the docs shows the day someone last checked it
  against the app, read from its front matter when the site is built, so the date never goes
  stale. The repository's own files carry no date: a shallow clone, as CI and Vercel make, cannot
  tell when they last changed.
*/

export type Footnote = {
  /** Where it comes from: a file at the root of the repository, or a page of the docs by its address. */
  source: { file: 'VISION.md' | 'README.md'; label: string } | { page: string }
  /** The source's own sentence, word for word. */
  quote?: string
}

const vision = (quote: string, part?: string): Footnote => ({
  source: { file: 'VISION.md', label: part ? `Vision, ${part}` : 'Vision' },
  quote,
})

export const footnotes: readonly Footnote[] = [
  vision(
    'Footnote exists so that an AI agent asked why a business number moved answers from what a person checked, or says plainly that nothing is written.',
  ),
  {
    source: { file: 'README.md', label: 'README' },
    quote:
      'Footnote is where the people who know why a number moved write it down, and the owner of that part of the business checks it.',
  },
  vision(
    'Each item carries the dates and the place it applies to, and it is told only for a question about those dates and that place.',
  ),
  vision(
    'An item ends itself: a question after its end date does not get it, and past its check date it is told as possibly out of date until its owner checks it again.',
  ),
  vision(
    'When nothing fits, the answer says so in plain words, and no agent is handed a guess that sounds sure.',
  ),
  vision(
    "Every other change to a live item, every retirement and every other suggestion waits for the domain's owner, and only a person publishes.",
    'Anyone may suggest, owners decide',
  ),
  vision(
    'The words of a draft, a suggestion, a comment, a report or a saved question never reach an agent and never shape an answer.',
  ),
  vision(
    'A definition says what a metric is; a context item says what happened to it, when and where.',
    'Meaning, not numbers',
  ),
  vision(
    'Footnote reads no figure and keeps none, and Ask says so plainly when a question needs one.',
  ),
  {
    source: { page: 'definitions-and-synonyms' },
    quote:
      "Built from: a tree of the metrics it takes, such as a ratio's two, and the metrics those take in turn, each a level in. Each line counts the published context about that metric you may read.",
  },
  vision(
    'Every answer starts with one of six fixed answer states, set by code from the items found, never by a model.',
  ),
  { source: { page: 'tools' } },
  {
    source: { page: 'connect-an-agent' },
    quote:
      'Connect Claude, Cursor or another agent, so it reads your published context before it answers a question about the numbers.',
  },
  { source: { page: 'prove' } },
  {
    source: { file: 'README.md', label: 'README, What is true today' },
    quote:
      'Footnote has not had its first release yet. It is for trying on one computer, not for production use, and it will change before 1.0.',
  },
  {
    source: { page: 'try-the-demo' },
    quote:
      'The first start builds the images from the code you cloned and loads the demo, which can take ten minutes.',
  },
  {
    source: { page: 'model-providers' },
    quote: 'Without MODELS=live, scripted models answer and nothing leaves this computer.',
  },
  {
    source: { page: 'privacy' },
    quote: 'Only what a question was about, and how often. Never the words, and never who asked.',
  },
]
