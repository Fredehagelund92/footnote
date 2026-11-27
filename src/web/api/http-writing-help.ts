import type {
  WritingHelpEvent,
  WritingHelpTurn,
  WritingHelpTurnInput,
} from '@contract/writing-help'
import type { SessionField } from '@/model/draft-session'
import { editorFields, type HelpEvent, type HelpReply } from '@/model/writing-help'
import type { FootnoteApi } from './client'

// Writing help on the Footnote service, as the dock hears it: the service names the fields a turn
// wrote as an agent does, and the editor by its own. Loaded with the first turn, so the first
// load of the app carries none of it.

/** The refusals by the editor's field: one line for each, the reasons of the service's fields joined. */
function refusalsOf(refused: WritingHelpTurn['refused']): HelpReply['refused'] {
  const byField = new Map<SessionField, string[]>()
  for (const r of refused) {
    const field = editorFields([r.field])[0]!
    const why = byField.get(field) ?? []
    if (!why.includes(r.why)) why.push(r.why)
    byField.set(field, why)
  }
  return [...byField].map(([field, why]) => ({ field, why: why.join(' ') }))
}

/** A turn of writing help as it ended, by the editor's fields. */
export function helpReplyOf(turn: WritingHelpTurn): HelpReply {
  return {
    reply: turn.reply,
    changed: editorFields(turn.changed),
    kept: editorFields(turn.kept),
    refused: refusalsOf(turn.refused),
    question: turn.question,
    links: turn.links,
    stopped: turn.stopped,
    limit: turn.limit,
  }
}

/**
 * What a turn of writing help tells the page as it runs, by the editor's fields; null for a write
 * that changed nothing, such as one that only kept the person's words.
 */
export function helpEventOf(event: Exclude<WritingHelpEvent, { type: 'turn' }>): HelpEvent | null {
  if (event.type === 'words') return event
  if (event.type === 'written')
    return event.applied.length ? { type: 'written', changed: editorFields(event.applied) } : null
  if (event.doing === 'reading')
    return { type: 'progress', progress: { doing: 'reading', links: event.links ?? 0 } }
  if (event.doing === 'looking') return { type: 'progress', progress: { doing: 'looking' } }
  const [field] = event.field ? editorFields([event.field]) : []
  return { type: 'progress', progress: { doing: 'writing', ...(field ? { field } : {}) } }
}

/**
 * One turn of writing help on the service: it runs as its events come, what it is doing, each
 * write as its field lands, the reply's words so far, then the turn. `open` sends the request,
 * which `live.signal` stops, the model's call with it. `changed` says the draft changed on the
 * service while the request is still open, so a read of it made a moment ago no longer serves.
 * Nothing comes back when the stream ended before its turn did.
 */
export async function helpTurn(
  { draftId, message, turns, live }: Parameters<FootnoteApi['writingHelp']>[0],
  open: (
    input: WritingHelpTurnInput,
    signal?: AbortSignal,
  ) => Promise<AsyncIterable<WritingHelpEvent>>,
  changed: () => void,
): Promise<HelpReply | undefined> {
  const events = await open({ draftId, message, ...(turns?.length ? { turns } : {}) }, live?.signal)
  let reply: HelpReply | undefined
  try {
    for await (const event of events) {
      if (event.type === 'written') changed()
      if (event.type === 'turn') reply = helpReplyOf(event.turn)
      else {
        const heard = helpEventOf(event)
        if (heard) live?.onEvent?.(heard)
      }
    }
  } finally {
    changed()
  }
  return reply
}
