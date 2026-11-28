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
  The same day the steps were keyed again with no model, after the reads stopped counting items
  that do not apply as not shown, began giving a metric's definition with its look-up, said which
  domains own the subject and shared a records read's rows among its groups: each step a build
  sends differently took the step the last real run took at the same place in the same case.
  19 steps follow tool results that are not the same from one run to the next even with the ids
  made afresh each run put back by place, so no recorded step matches them: the scripted reader
  takes those in every build, which is why K18's follow-up is listed as missing here.
  A bare word that names no one metric ("revenue") is asked about by code before the model reads
  (H16), so that case needs no recorded step; in a sentence the model reads the metrics it may mean.
  G02's sentence with a hole is gone since code drops the brackets a placed mention leaves empty.
  On 23 November 2026 find_context's wider search began taking its other names as a list, each
  searched on its own, so the steps that wrote one phrase of them failed to read: K10, K11, G21 and
  F09 were recorded again (Haiku 5.5, one try, USD 0.016). In it F09 widens by three other names
  and says nothing published covers Black Friday; K10 and G21 answer the France switch where they
  should ask which one. Two more tries of each: K10 asks 1 of 2 times, and G21 asks in neither, as
  on main's code.
  The same day Ask's instructions began to carry About our business, get_context began to say
  what the terms its words use mean, and the demo week gained three terms, so every step was keyed
  again with no model, by place, as above. One more step goes unrecorded: a place in the case
  about what is missing from Definitions that main's code never reaches.
  On 24 November 2026 every step was recorded again (Haiku 5.5, one try, USD 0.32), after
  get_context began to give what applies in the order of the question's own words, every tool
  began to read a name the same way and to give the words it could not read, and a follow-up began
  to send the earlier messages as they were first sent. 18 steps go unrecorded. The held-back count
  fell from 15 to 11: main's own code, run once live the same day the same way (USD 0.33), passed
  9 held-back cases where this run passed 8, and both said what they must in 12, so the 15 was the
  19 November run's and not today's code's. Read by hand, the new breaks are that run's own words:
  G01 counts a list itself ("six metrics"); GP10 gives its own advice ("Use Sweden orders from 19
  January 2026"); H06 tells of the answer check in its own voice ("The checker flagged two counts I
  wrote"); F12 and G23 say what they must not.
  On 25 November 2026 the steps were keyed again with no model, by place, as above, after the
  answer's state began to come from every item that applies and not only the page shown, and a
  follow-up began to send each earlier read in the step that made it, with the words before it.
  The same day Ask's prompt began to carry the names card (FR-718.8), after the instructions, so
  every step was keyed again with no model: each took the recorded step whose prompt was the same
  but for the card. These steps are therefore the model's as it answered without the card, and
  the held-back count above is that answer's: awaiting a re-record, which is where the card's
  effect on the model's reads (D3: 8 of 10 questions that name a metric loosely read a subject at
  the first try) is measured.
  On 27 November 2026 a question that names a value and no metric began to read the items of every
  metric that apply to that value (the agent-side review, finding 1), so K13 ("how many items are
  about norway") reads more than its recorded steps, which were keyed before: it awaits a re-record
  with the others.
  On 27 November 2026 Write context's help began to tell of its first box, so the step that read
  that page for FP14 no longer matches it: FP14 awaits a re-record with the others.
  On 28 November 2026 the Inbox's groups and the records' status took the names Nothing written
  yet and Needs a recheck, so every step was keyed again with no model, by place, as above, and
  the words of the recorded steps that said the earlier names follow them. They are still the
  model's steps, and the lists below did not move.
  The same day the words agents and people read began to say a value of a dimension where they
  said a market (About our business, the tools' sentences, the help), so every step was keyed
  again with no model: each took the recorded step whose prompt was the same but for those words.
  As many steps go unrecorded as on main's code, and the lists below did not move.
*/

askEvalSuite({
  brokenToday: {
    numbers: ['G01'],
    advice: ['V04', 'GP10'],
    state: ['K16'],
    voice: ['F25', 'H06'],
    never: ['F12', 'G06', 'G23', 'H04', 'H06'],
  },
  missingToday: [
    'C2',
    'K10',
    'K12',
    'K13',
    'K15',
    'K18',
    'V09',
    'V11',
    'F01',
    'F06',
    'F07',
    'F12',
    'F16',
    'F17',
    'F18',
    'F19',
    'F21',
    'F25',
    'F28',
    'F30',
    'FP01',
    'FP02',
    'FP03',
    'FP04',
    'FP12',
    'FP14',
    'G01',
    'G03',
    'G05',
    'G07',
    'G08',
    'G12',
    'G13',
    'G14',
    'G15',
    'G18',
    'G21',
    'G22',
    'G29',
    'GP01',
    'GP04',
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
  heldPassingToday: 11,
})
