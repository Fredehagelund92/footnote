import { linksIn } from '@domain/writing-help'
import type { SessionField } from '@/model/draft-session'
import type { Fact } from '@/model/items'
import type { HelpReply } from '@/model/writing-help'
import { norwayDraft } from './data/drafts'

// Writing help on the mock: a design preview with no model, as the mock's Ask is. It plays the
// first minute the design draws (a message becomes the Norway draft, as the mock's Draft from text
// fills it, field by field) and the few changes the demo can make by rule: add Don't conclude,
// make the text shorter. Anything else it says it cannot do here. On the service a model writes.

/** Between two fields landing, so the draft is seen to fill in. */
export const MOCK_FIELD_MS = 350

/** One field as the mock writes it: the part of the item it changes. */
export type MockWrite = { field: SessionField; patch: Partial<Fact> }

export type MockTurn = {
  writes: MockWrite[]
  reply: string
  question: HelpReply['question']
}

const NORWAY_CAVEAT = 'Fewer orders in Norway after 4 August do not mean fewer customers.'

const sentences = (text: string) => text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text]

/** Whether the draft holds nothing to write from yet: no text, and no title of its own. */
const blank = (draft: Fact) =>
  !draft.summary.trim() && !draft.body?.trim() && (!draft.title || /^Untitled/.test(draft.title))

/** What the mock does with a message, by rule: the fields it writes and what it says. */
export function mockTurn(draft: Fact, message: string, owner: string): MockTurn {
  const said = message.trim().toLowerCase()
  if (blank(draft)) {
    const from = norwayDraft
    const read = linksIn(message).length ? 'your message and the notice' : 'your message'
    return {
      writes: [
        { field: 'title', patch: { title: from.title } },
        { field: 'kind', patch: { kind: from.kind } },
        { field: 'where', patch: { where: from.where, scope: from.scope } },
        { field: 'when', patch: { valid: from.valid, when: from.when } },
        { field: 'source', patch: { source: from.source, quote: from.quote } },
        { field: 'text', patch: { summary: from.summary, body: from.body } },
      ],
      reply: `I wrote a draft from ${read}. Check each field, then send it to ${owner}.`,
      question: {
        text: `Don't conclude is empty. Should it say: “${NORWAY_CAVEAT}”?`,
        answers: ['Yes, add it', 'No, leave it empty'],
      },
    }
  }
  if (said === 'yes, add it')
    return {
      writes: [{ field: 'dontConclude', patch: { dontConclude: NORWAY_CAVEAT } }],
      reply: "Added to Don't conclude.",
      question: null,
    }
  if (said === 'no, leave it empty')
    return { writes: [], reply: "I left Don't conclude empty.", question: null }
  if (/\bshort/.test(said)) {
    const first = sentences(draft.summary).slice(0, 1).join('').trim()
    const shorter = first !== draft.summary.trim() || !!draft.body
    return shorter
      ? {
          writes: [{ field: 'text', patch: { summary: first, body: undefined } }],
          reply: 'I made the text shorter. Nothing else changed.',
          question: null,
        }
      : { writes: [], reply: 'The text is one sentence already, so I left it.', question: null }
  }
  return {
    writes: [],
    reply:
      'I can’t do that in this demo, which runs without an AI model. Here I can write a first draft from a message, add what not to conclude, or make the text shorter.',
    question: null,
  }
}
