import { askEvalSuite } from './ask-eval-suite.ts'

/*
  Ask's evaluation harness on Ask's loop (docs/evaluations.md): one model on the read tools, run
  as the person asking, through the real service on the demo week. In every build the model's
  steps are those of the last real run (ask-eval-loop-steps.json), and the scripted reader takes
  any step the run did not record. What it breaks and misses there is listed below, by promise and
  by what a case must say: only ever shorter. The held-back cases are a count.

  Read by hand, the breaches listed are: V04, a decline the advice pattern reads as advice ("Ask
  does not answer questions about what you should do"); FP10, a guide's own words repeated,
  attributed and cited ("so you should read a campaign only once its 30 days have passed"), which
  the advice pattern reads as advice; and four must-nots (F12 names the 21 May item). About 30
  steps follow tool results that are not the same from one run to the next (an Inbox card's id is
  made afresh each run), so no recorded step matches them, even on the code that recorded them:
  the scripted reader takes those in every build. Every step was recorded again on 15 November
  2026, after the loop's prompt began to speak to the person as you and of itself as Ask. In that
  run V09, F19 (orders in Jordan) and F02 (Spain in October) cite items a search matched on some
  of their words, so they are Partial where the cases expect Not found.
*/

askEvalSuite({
  answerer: 'loop',
  brokenToday: {
    advice: ['V04', 'FP10'],
    never: ['F12', 'G06', 'H04', 'H06'],
  },
  missingToday: [
    'C2',
    'K01',
    'K10',
    'K12',
    'K15',
    'V04',
    'V09',
    'F01',
    'F02',
    'F05',
    'F06',
    'F07',
    'F12',
    'F14',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F25',
    'F29',
    'FP02',
    'FP03',
    'FP04',
    'FP10',
    'FP11',
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
    'G27',
    'G29',
    'GP01',
    'GP04',
    'GP07',
    'GP11',
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
  heldPassingToday: 11,
})
