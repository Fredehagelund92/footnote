import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on today's main (docs/evaluations.md): the router, the planner and the
  words, through the real service on the demo week, on the plans of the last real run in every
  build. What it breaks and misses there is listed below, by promise and by what a case must say:
  only ever shorter. The held-back cases are a count. The router still declines "who checked that
  last?" as one person's work (K16 to K18), and its decline points to an item's history rather
  than the loop's words (V13, V14): Ask's loop, on by default, answers it.
*/

askEvalSuite({
  answerer: 'main',
  brokenToday: { never: ['C1', 'K01', 'K13', 'K16', 'K17', 'K18', 'F30'] },
  missingToday: [
    'C1',
    'C2',
    'K01',
    'K15',
    'K16',
    'K17',
    'K18',
    'V01',
    'V04',
    'V07',
    'V09',
    'V13',
    'V14',
    'F05',
    'F07',
    'F19',
    'F25',
    'F28',
    'F30',
    'FP04',
    'G13',
    'G15',
    'G18',
    'G25',
    'G29',
    'GP05',
    // A follow-up that only re-reads a Partial answer's source carries Partial, not Grounded.
    'GP11',
    'H05',
  ],
  heldPassingToday: 19,
})
