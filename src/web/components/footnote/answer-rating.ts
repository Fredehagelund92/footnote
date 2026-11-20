import type { useWrite } from '@/api/queries'
import type { Answer } from '@/model/ask'

export type Verdict = 'helpful' | 'wrong'
type Counted = { id: string; verdict: Verdict } | null

/** The metrics an answer read (at most the ten a rating takes), for its domain: the engine's keys, or the loop's subject. */
const ratedMetrics = (answer: Answer) =>
  (
    answer.keys?.metrics ??
    (answer.loop?.subject?.about ?? []).filter((id) => id.startsWith('metric:'))
  ).slice(0, 10)

/** The clicks of one answer, applied in order, and what they wish: loaded with the first click. */
export type RatingChain = { counted: Promise<Counted>; queued: number; wish: Verdict | null }

export const newChain = (): RatingChain => ({
  counted: Promise.resolve(null),
  queued: 0,
  wish: null,
})

/**
 * One click of Good or Bad answer: one chain, so clicks apply in order, and the pressed button
 * follows what the chain holds once nothing later is queued.
 */
export function rate(
  chain: RatingChain,
  verdict: Verdict,
  answer: Answer,
  write: ReturnType<typeof useWrite>,
  setRated: (verdict: Verdict | null) => void,
  fail: (title: string, description: string) => void,
) {
  const next = chain.wish === verdict ? null : verdict
  chain.wish = next
  setRated(next)
  chain.queued += 1
  chain.counted = chain.counted.then(async (held) => {
    let now = held
    if (held)
      try {
        await write('takeBackRating', { id: held.id })
        now = null
      } catch {
        fail("Your rating wasn't taken back", 'It still counts. Click it again in a moment.')
      }
    if (!now && next)
      try {
        now = {
          id: (await write('rateAnswer', { verdict: next, metrics: ratedMetrics(answer) })).id,
          verdict: next,
        }
      } catch {
        fail('Your rating may not have counted', 'Click it again in a moment to be sure.')
      }
    chain.queued -= 1
    if (chain.queued === 0) {
      chain.wish = now?.verdict ?? null
      setRated(chain.wish)
    }
    return now
  })
}
