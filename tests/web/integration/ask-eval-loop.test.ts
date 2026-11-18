import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Every step was recorded again on 17 November 2026 (Haiku 5.5, one try), after get_context took
  relative_to, to read a follow-up's period against the last question's, and gave the days it
  read. Read by hand, the breaks listed are that run's own words: V06 gives the floor of 5 beside
  a topic the reader sees no count for (the grader reads it as a hidden count), GP10 repeats an
  item's "use ... from 19 January 2026" in its own voice, V04 says what Ask does not answer, H24
  says Ask does not answer and cites no item under a Partial read, V08 says "0 of 6", F12 names
  a third France item, G06 names an April item among October's checks, V02 starts its decline
  with "No", H04 and H06 as before, and H24 names the owners of two domains by the domains'
  own mentions ("the owners of Paid media and Sales are Paid media and Sales").
  About 25 steps follow tool results that are not the same from one run to the next (an Inbox
  card's id is made afresh each run), so no recorded step matches them, even on the code that
  recorded them: the scripted reader takes those in every build.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    hidden: ['V06'],
    advice: ['V04', 'GP10'],
    state: ['H24'],
    whole: ['H24'],
    never: ['V02', 'V08', 'F12', 'G06', 'H04', 'H06'],
  },
  missingToday: [
    'C2',
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
    'F28',
    'F29',
    'F30',
    'FP01',
    'FP02',
    'FP03',
    'FP04',
    'FP07',
    'FP10',
    'FP12',
    'G01',
    'G03',
    'G05',
    'G07',
    'G08',
    'G12',
    'G13',
    'G15',
    'G18',
    'G21',
    'G22',
    'G23',
    'G29',
    'G30',
    'GP01',
    'GP02',
    'GP04',
    'GP06',
    'GP07',
    'GP12',
    'GP15',
    'H02',
    'H03',
    'H04',
    'H07',
    'H08',
    'H10',
    'H13',
    'H14',
    'H15',
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
  heldPassingToday: 9,
})
