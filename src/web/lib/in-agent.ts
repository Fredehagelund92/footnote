import { lookupFailedNote } from '@domain/words'
import type { AnswerState } from '@/model/ask'

// How the same answers read inside a person's own agent: a static transcript for the agent
// preview, each answer ending in the one line that names its state. Copy, not data, and shown on
// every install: it names no market or product of the demo's.

/** The same states as an agent shows them: a static transcript in Claude. */
export const inAgent = [
  {
    state: 'grounded' as AnswerState,
    you: 'Why did orders drop in August?',
    agent: `Orders fell 31% from July (from your data tool). The team has 2 checked context items: the webshop was down from 4 to 6 August 2026, and price promotions have been paused since 9 May. Neither says how much each moved orders.`,
    line: 'Context: based on 2 checked items (owners of Sales and Marketing, Sep and Oct 2026).',
  },
  {
    state: 'partial' as AnswerState,
    you: 'And orders and returns, last quarter?',
    agent:
      'The checked context covers part of this: there is context for orders and nothing for returns. I read “last quarter” as 1 July to 30 September 2026; tell me if you meant other dates.',
    line: 'Context: covers part of it (orders only).',
  },
  {
    state: 'missing' as AnswerState,
    you: 'How did returns change in October?',
    agent:
      "Nothing is written down for Returns in October 2026. That doesn't rule out an explanation. Shall I tell the owner of Sales it's missing?",
    line: 'Context: nothing written down.',
  },
  {
    state: 'conflict' as AnswerState,
    you: 'Do orders include shipping fees?',
    agent:
      "Two context items disagree. Jon Abara's says orders include shipping fees; Sofia Brandt's says they leave them out. I can't pick one for you.",
    line: 'Context: disagrees (2 items, owner of Sales).',
  },
  {
    state: 'stale' as AnswerState,
    you: 'Why did returns drop at the end of April?',
    agent:
      "From 28 April 2026, returns count only refunds that reached the customer's bank. This context item may be out of date: its check date passed on 2 October.",
    line: 'Context: may be out of date (1 item).',
  },
  {
    state: 'failed' as AnswerState,
    you: 'What changed in returns this week?',
    agent: lookupFailedNote,
    line: 'Context: not looked up.',
  },
]

export const correctionInAgent = [
  { who: 'you', text: "The test account number you quoted is wrong, it's 340 now." },
  { who: 'agent', text: 'Shall I send that correction to the owner of Sales, with your words?' },
  { who: 'you', text: 'Yes.' },
  { who: 'agent', text: 'Sent. Agents get it once Jon Abara, the owner, publishes it.' },
]
