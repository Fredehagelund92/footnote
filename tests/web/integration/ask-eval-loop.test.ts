import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Every step was recorded again on 19 November 2026 (Haiku 5.5, one try), after the answer check
  held the words to one voice (H14): the 43 cases that broke it on the last recording are 5.
  Read by hand, the breaks listed are that run's own words: C2 says "Ask searched every domain",
  K13 and G15 say what "that read" settles, F25 writes "A specific metric I will name now", P10
  says "a wider read found 0", each kept as written once the check's second writing still broke
  only the voice; F02 and H24 give a count beside a topic the reader sees only as 9+ (the grader
  reads "out of 21 published context items" and "30 days" as its count); V02 starts its decline
  with "No", F12 names a third France item, H04 and H06 as before, and H24 names VAT.
  13 steps follow tool results that are not the same from one run to the next even with the ids
  made afresh each run put back by place, so no recorded step matches them: the scripted reader
  takes those in every build.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    hidden: ['F02', 'H24'],
    voice: ['C2', 'K13', 'F25', 'G15', 'P10'],
    never: ['V02', 'F12', 'H04', 'H06', 'H24'],
  },
  missingToday: [
    'C1',
    'K01',
    'K10',
    'K12',
    'K15',
    'V07',
    'V09',
    'F01',
    'F02',
    'F05',
    'F06',
    'F07',
    'F12',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F25',
    'F26',
    'F29',
    'F30',
    'FP01',
    'FP02',
    'FP04',
    'FP12',
    'G01',
    'G03',
    'G05',
    'G06',
    'G07',
    'G08',
    'G12',
    'G13',
    'G15',
    'G18',
    'G21',
    'G22',
    'G23',
    'G27',
    'G29',
    'G30',
    'GP01',
    'GP04',
    'GP06',
    'GP07',
    'GP12',
    'GP15',
    'H02',
    'H03',
    'H04',
    'H05',
    'H07',
    'H08',
    'H10',
    'H13',
    'H14',
    'H15',
    'H16',
    'H18',
    'H20',
    'H24',
    'H25',
    'H28',
    'H29',
    'H30',
    'P04',
    'P05',
    'P10',
    'P13',
  ],
  heldPassingToday: 10,
})
