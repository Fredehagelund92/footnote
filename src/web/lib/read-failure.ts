import type { Source } from '@/model/integrations'

/** When a read was, inside a sentence: "today at 06:00", "yesterday at 06:00", "on 21 Oct at 06:00". */
const readAt = ({ day, time }: { day: string; time: string }) =>
  day === 'Today'
    ? `today at ${time}`
    : day === 'Yesterday'
      ? `yesterday at ${time}`
      : `on ${day} at ${time}`

/**
 * What a failed read says: what went wrong, then what agents still get and what to do. Each is
 * whole sentences, chosen for the case, never glued from parts.
 */
export function readFailureLines(
  s: Pick<Source, 'failures' | 'failure' | 'lastGood' | 'staleAfter'>,
) {
  const why = s.failure ?? "it couldn't be read"
  const what =
    s.failures > 1
      ? `The last ${s.failures} reads failed: ${why}.`
      : `The last read failed: ${why}.`
  const still = s.lastGood
    ? `Agents still get what was read ${readAt(s.lastGood)}.`
    : 'Nothing was read yet.'
  return {
    what,
    next: `${still} Press Read again. If it still fails after ${s.staleAfter}, admins get a card.`,
  }
}
