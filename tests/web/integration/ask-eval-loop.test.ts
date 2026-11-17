import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Every step was recorded again on 17 November 2026 (Haiku 5.5, one try), after get_context took
  the person's own words for a period and the read line said what else the days could mean. Read
  by hand, the breaks listed are that run's own words: V07 repeats the person's own 12 beside the
  floor of 10 or more it may say (the grader reads the 12 as a hidden count), V04 says what Ask
  does not answer, H20 says "you should see", V02 starts its decline with "No", and H04 and H06 as
  before. About 25 steps follow tool results that are not the same from one run to the next (an
  Inbox card's id is made afresh each run), so no recorded step matches them, even on the code
  that recorded them: the scripted reader takes those in every build.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    hidden: ['V07'],
    advice: ['V04', 'H20'],
    never: ['V02', 'H04', 'H06'],
  },
  missingToday: [
    'C2',
    'K01',
    'K10',
    'K12',
    'K15',
    'V09',
    'F01',
    'F02',
    'F05',
    'F06',
    'F07',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F25',
    'F29',
    'F30',
    'FP01',
    'FP02',
    'FP04',
    'FP10',
    'FP12',
    'G01',
    'G03',
    'G05',
    'G06',
    'G07',
    'G12',
    'G13',
    'G15',
    'G18',
    'G21',
    'G22',
    'G23',
    'G29',
    'GP01',
    'GP02',
    'GP04',
    'GP07',
    'GP12',
    'GP15',
    'H02',
    'H03',
    'H04',
    'H06',
    'H07',
    'H08',
    'H10',
    'H13',
    'H14',
    'H15',
    'H16',
    'H18',
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
  heldPassingToday: 11,
})
