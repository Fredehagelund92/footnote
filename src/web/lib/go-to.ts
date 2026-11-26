import { GO_TO, pageKey, type GoPlace } from '@/lib/keys'
import { navigate } from '@/lib/router'
import { settingsHref } from '@/lib/settings-access'

// G then a letter goes to a place (GO_TO, in lib/keys.ts), from anywhere nobody is typing, as in
// Linear. The ? sheet (lib/help-content.ts) and the command menu's Go to rows show these same keys.

type Who = { admin: boolean; owns: readonly string[] }

/** Where a place is, for this person: Settings opens on the section that is theirs. */
export const placeHref = (place: GoPlace, me: Who) =>
  place === 'Settings' ? settingsHref(me) : `/${place.toLowerCase()}`

/** The letter after G that goes to a place. */
export const goKey = (place: GoPlace) => GO_TO.find((g) => g.place === place)!.key

/**
 * How long after G its letter may come, timed as the page hears the keys, so a page that is busy
 * for a moment loses neither.
 */
const WITHIN_MS = 1500

/**
 * Listens for G then a letter while the app is open; returns the way to stop. The letter is taken
 * before anything else hears it, so G then C never also comments in a review.
 */
export function listenForGoTo(me: () => Who) {
  let armed = 0
  const down = (e: KeyboardEvent) => {
    if (e.repeat || e.shiftKey || !pageKey(e)) {
      armed = 0
      return
    }
    const key = e.key.toUpperCase()
    const now = performance.now()
    const to = armed && now - armed < WITHIN_MS && GO_TO.find((g) => g.key === key)
    armed = !to && key === 'G' ? now : 0
    if (!to) return
    e.preventDefault()
    e.stopImmediatePropagation()
    navigate(placeHref(to.place, me()))
  }
  window.addEventListener('keydown', down, true)
  return () => window.removeEventListener('keydown', down, true)
}
