import { dayIn } from '../domain/dates.ts'

/**
 * The service's sense of time. Domain code takes `today` as an argument; the service gets it here,
 * so tests and demo runs can pin it (`HEED_FIXED_TODAY`, refused in production).
 */
export interface Clock {
  /** The current instant. */
  now(): Date
  /** The current UTC day as YYYY-MM-DD (NFR-048: days are UTC days). */
  today(): string
  /** The current day in a time zone; without it, a clock's today is the same in every zone. */
  todayIn?(timeZone: string): string
}

/**
 * Today in the workspace's time zone (`calendar.time_zone`), which Ask and agents read dates
 * from. A pinned day stays the same in every zone.
 */
export const todayIn = (clock: Clock, timeZone: string): string =>
  clock.todayIn?.(timeZone) ?? clock.today()

/** The same clock on another day: its time still runs, for request limits and timings. */
export const onDay = (clock: Clock, day: string): Clock => ({
  now: () => clock.now(),
  today: () => day,
})

export function systemClock(fixedToday?: string): Clock {
  return {
    now: () => new Date(),
    today: () => fixedToday ?? new Date().toISOString().slice(0, 10),
    todayIn: (timeZone) => fixedToday ?? dayIn(new Date(), timeZone),
  }
}
