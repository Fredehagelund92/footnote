import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Every step was recorded again on 19 November 2026 (Haiku 5.5, one try, USD 0.31), after Ask's
  loop learned to decline with `decline` and to answer who last checked one item (H15), and the
  answer check began to tell the second writing the very words that break the voice ("“Ask
  checked” ... leave those words out"). The cases breaking the voice went from 5 to 1. Read by
  hand, the breaks listed are that run's own words: F25 asks back as I ("I will type it"), kept as
  written once the second writing still broke only the voice; V07 and G18 give "the published
  context items you can see 21" beside a topic the reader sees only as 10+, which the grader reads
  as its count; V04 and G20 repeat "compare them against how you pull your figures" in Ask's own
  voice; K16 and V04 cite one of the two items that disagree; G22 says "out of 23 you can see 7
  of"; V09, H04, H06 and H13 name what they must not.
  18 steps follow tool results that are not the same from one run to the next even with the ids
  made afresh each run put back by place, so no recorded step matches them: the scripted reader
  takes those in every build, which is why K18's follow-up is listed as missing here.
  A word that names no one metric ("What about sales in the UK?") is asked about by code before
  the model reads (H16), so those cases need no recorded step.
*/

askEvalSuite({
  brokenToday: {
    hidden: ['V07', 'G18'],
    advice: ['V04', 'G20'],
    state: ['K16', 'V04'],
    whole: ['G22'],
    voice: ['F25'],
    never: ['V09', 'H04', 'H06', 'H13'],
  },
  missingToday: [
    'C1',
    'C2',
    'K10',
    'K12',
    'K18',
    'V09',
    'V11',
    'F01',
    'F02',
    'F05',
    'F06',
    'F07',
    'F12',
    'F15',
    'F16',
    'F17',
    'F19',
    'F21',
    'F25',
    'F29',
    'F30',
    'FP01',
    'FP02',
    'FP04',
    'FP07',
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
    'G25',
    'G27',
    'G29',
    'G30',
    'GP01',
    'GP04',
    'GP06',
    'GP07',
    'GP12',
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
  heldPassingToday: 14,
})
