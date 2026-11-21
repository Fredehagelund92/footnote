import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Every step was recorded again on 21 November 2026 (Haiku 5.5, one try, USD 0.34), after Ask's
  loop learned to answer a question about Footnote from its help, to tell the model which metrics
  a word in a sentence may mean (asking back by code only on the bare word), to answer in the
  language of the latest message, and to find a definition by its short name. Two real runs of the
  same code differ by more than these lists, so they moved both ways. Read by hand, the breaks
  listed are that run's own words: F25 asks back as I ("Name the metric so I can check"); F10 and
  H02 give a topic's or a domain's count where the reader sees only a floor; V04 says "Ask points
  to what is written" in its own voice; K16 keeps Conflict over a follow-up that cites one of the
  two items; F11 and FP04 leave a sentence with a hole ("one in Marketing 2 and."); V02, V08,
  G06, H04, H06, H13 and H24 say what they must not.
  19 steps follow tool results that are not the same from one run to the next even with the ids
  made afresh each run put back by place, so no recorded step matches them: the scripted reader
  takes those in every build, which is why K18's follow-up is listed as missing here.
  A bare word that names no one metric ("revenue") is asked about by code before the model reads
  (H16), so that case needs no recorded step; in a sentence the model reads the metrics it may mean.
  G02's sentence with a hole is gone since code drops the brackets a placed mention leaves empty.
*/

askEvalSuite({
  brokenToday: {
    hidden: ['F10', 'H02'],
    advice: ['V04'],
    state: ['K16'],
    whole: ['F11', 'FP04'],
    voice: ['F25'],
    never: ['V02', 'V08', 'G06', 'H04', 'H06', 'H13', 'H24'],
  },
  missingToday: [
    'C2',
    'K12',
    'K16',
    'K18',
    'V01',
    'V09',
    'V11',
    'F01',
    'F02',
    'F04',
    'F05',
    'F06',
    'F07',
    'F09',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F25',
    'F28',
    'F29',
    'F30',
    'FP02',
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
    'G22',
    'G23',
    'G25',
    'G29',
    'GP04',
    'GP06',
    'GP07',
    'GP12',
    'GP15',
    'H02',
    'H03',
    'H04',
    'H05',
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
  heldPassingToday: 15,
})
