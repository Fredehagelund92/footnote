import { answers } from './demo.ts'

/*
  What the meaning section shows (landing/pages/index.astro, #meaning): a question about orders in
  Norway that rewrites itself as the reader drags along the Orders line, what Footnote matches for
  the week picked, and what the agent then says. The page shows no figure. The line's shape and the
  words for each week come from an invented weekly series of Orders in Norway, made here and drawn
  without numbers; it is not the demo's data. The note, its writer, its checker and its check date
  are the demo's own Norway note (landing/demo.ts).
*/

/** One week of the invented series: its Monday and its orders. */
export type Week = { monday: string; orders: number }

const shortMonths = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * Orders in Norway, 2026, invented: one figure a week from Monday 5 January to Monday 23 November,
 * near steady until online sales stop on Tuesday 4 August (week 30), and a trickle after.
 */
function invent(): Week[] {
  const weeks: Week[] = []
  const start = Date.UTC(2026, 0, 5)
  let seed = 7
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
  for (let i = 0; i < 47; i++) {
    let orders: number
    if (i < 30) orders = 1140 + 150 * Math.sin(((i - 4) / 30) * Math.PI) + next() * 110
    else if (i === 30) orders = 212
    else orders = 30 + next() * 18
    weeks.push({
      monday: new Date(start + i * 7 * 864e5).toISOString().slice(0, 10),
      orders: Math.round(orders),
    })
  }
  return weeks
}

export const weeks: readonly Week[] = invent()
/** The last week's index. */
export const last = weeks.length - 1
/** The week online sales stopped in: Monday 3 August, the stop on its Tuesday. */
export const stop = 30
/** The week the section opens on, and where the opening walk starts. */
export const opening = 31
export const walkFrom = 25

const norway = answers.find((answer) => answer.key === 'norway')!.notes[0]!
/** The demo's Norway note, as the section shows it. */
export const note = {
  title: norway.title,
  writer: norway.who[0]!.name,
  checker: norway.who[1]!.name,
  checkedOn: norway.who[1]!.tail!.split(', ').at(-1)!,
}

const date = (i: number) => new Date(`${weeks[i]!.monday}T00:00:00Z`)

/** The Monday of week i, as the question says it: "10 Aug 2026". */
export function day(i: number) {
  const d = date(i)
  return `${d.getUTCDate()} ${shortMonths[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Week i from Monday to Sunday: "10 to 16 Aug", or "27 Jul to 2 Aug". */
function span(i: number) {
  const a = date(i)
  const b = new Date(a.getTime() + 6 * 864e5)
  const end = `${b.getUTCDate()} ${shortMonths[b.getUTCMonth()]}`
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} to ${end}`
    : `${a.getUTCDate()} ${shortMonths[a.getUTCMonth()]} to ${end}`
}

/** Before the stop: the week against the one before it, in words. */
function steady(i: number) {
  if (!i) return 'About the same as usual'
  const change = weeks[i]!.orders / weeks[i - 1]!.orders - 1
  return change > 0.05
    ? 'A little up on the week before'
    : change < -0.05
      ? 'A little down on the week before'
      : 'About the same as the week before'
}

const because = 'because online sales there stopped on 4 August under a new customs rule.'

/** What the section shows for week i. */
export function week(i: number) {
  const applies = i >= stop
  // No figure on the page: the move is said in words, as the agent would say it from Cube's.
  const move = applies ? (i === stop ? 'A sharp fall' : 'Almost nothing') : steady(i)
  return {
    day: day(i),
    applies,
    move,
    dates: `${span(i)}, ${i === stop ? 'takes in' : applies ? 'after' : 'before'} 4 Aug`,
    /** The agent's sentence; it ends on the note's number when the note applies. */
    says: !applies
      ? `Orders in Norway were ${move.toLowerCase()}. Nothing is written about that week.`
      : i === stop
        ? `Orders in Norway fell sharply that week, ${because}`
        : `Orders in Norway were almost nothing that week, ${because}`,
  }
}

/** The chart's line runs from `top` to `floor` of a 1000 by 1000 box. */
const top = 120
const floor = 930
const peak = Math.max(...weeks.map((w) => w.orders))

/** Where week i sits on the chart, as fractions of its width and height. */
export function at(i: number) {
  return {
    x: i / last,
    y: (floor - (weeks[i]!.orders / peak) * (floor - top)) / 1000,
  }
}

/** The line, in the chart's 1000 by 1000 box. */
export const path = weeks
  .map((_, i) => {
    const { x, y } = at(i)
    return `${i ? 'L' : 'M'}${(x * 1000).toFixed(1)},${(y * 1000).toFixed(1)}`
  })
  .join(' ')

/** Where the note starts to apply on the chart: Tuesday 4 August, a seventh into week 30. */
export const from = (stop + 1 / 7) / last

/** The months under the line, each at its first Monday; a phone shows every other one. */
export const months = weeks.flatMap((w, i) => {
  const m = Number(w.monday.slice(5, 7)) - 1
  if (i && Number(weeks[i - 1]!.monday.slice(5, 7)) - 1 === m) return []
  return [{ label: shortMonths[m]!, x: i / last, narrow: m % 2 === 0 }]
})

/** The line in words, for a reader who cannot see it. */
export const described =
  'Orders in Norway, week by week in 2026, invented for this page: about the same each week until 4 August, then almost nothing.'
