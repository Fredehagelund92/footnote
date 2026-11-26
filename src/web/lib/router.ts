import * as React from 'react'
import { useRouterState, type AnyRouter, type RouterHistory } from '@tanstack/react-router'

// The app's addresses are TanStack Router file routes (routes/), each with its search params
// validated (lib/search.ts). Pages read and change the address through this module: the path, its
// parts and the validated query, as one value.

export type Route = { path: string; parts: string[]; query: URLSearchParams }

let router: AnyRouter | undefined
let history: RouterHistory | undefined

/** The path before the address last moved to another one: what Back has just come back from. */
let here = ''
let left = ''

/**
 * The places opened from a list in this tab (`openFromList`), by their history entry: the list's
 * path, which is the entry before. A step forward drops the entries it takes the place of.
 */
const openers = new Map<number, string>()
let opening: string | undefined

/** The router every navigation goes through; main.tsx binds it once, before the first render. */
export function bindRouter(r: AnyRouter) {
  router = r
  history = r.history as RouterHistory
  here = history.location.pathname
  history.subscribe(({ location, action }) => {
    if (action.type === 'PUSH') {
      const at = location.state.__TSR_index
      for (const index of openers.keys()) if (index >= at) openers.delete(index)
      if (opening) openers.set(at, opening)
      opening = undefined
    }
    if (location.pathname === here) return
    left = here
    here = location.pathname
  })
}

/** The path the address was on before this one, such as the item page Back has just left. */
export const cameFrom = () => left

/** The validated search of the deepest match, as the query a page reads. */
function queryOf(search: Record<string, unknown>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) if (typeof v === 'string') q.set(k, v)
  return q.toString()
}

export function useRoute(): Route {
  const key = useRouterState({
    select: (s) => {
      const leaf = s.matches.at(-1)
      const path = (s.resolvedLocation ?? s.location).pathname
      return `${path}?${queryOf(leaf?.search ?? {})}`
    },
  })
  return React.useMemo(() => {
    const [path, search] = key.split('?') as [string, string]
    return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(search) }
  }, [key])
}

/**
 * The part of the app the person is going to. It changes with the click, where `useRoute` waits for
 * the page, so what says where they are answers at once however long the page's code takes.
 */
export const useDestination = () =>
  useRouterState({ select: (s) => s.location.pathname.split('/')[1] || 'inbox' })

/**
 * The address as one navigation made it. A new value comes with every navigation, Back and Forward
 * included, so it is never the same again once the address has moved: compare it by identity.
 */
export const useLocationNow = () => useRouterState({ select: (s) => s.location })

/** The address as it stands, outside React. */
function current(): Route {
  const s = router!.state
  const path = (s.resolvedLocation ?? s.location).pathname
  const query = new URLSearchParams(queryOf(s.matches.at(-1)?.search ?? {}))
  return { path, parts: path.split('/').filter(Boolean), query }
}

/** The path as it stands, outside React: where a toast's action finds the person. */
export const pathNow = () => current().path

export function href(path: string, query?: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v)
  const s = q.toString()
  return `${path}${s ? `?${s}` : ''}`
}

/** Go somewhere. With `replace` it takes the place of the address now, so Back skips it. */
export function navigate(
  path: string,
  query?: Record<string, string | undefined>,
  opts?: { replace?: boolean },
) {
  void router!.navigate({ href: href(path, query), replace: opts?.replace })
}

/**
 * Open a place from the list on screen (a review from the Inbox). Leaving it by Esc then goes back
 * to the list's own entry (`backToList`) instead of adding one, so the next Back leaves the list.
 */
export function openFromList(path: string, query?: Record<string, string | undefined>) {
  opening = history!.location.pathname
  navigate(path, query)
}

/**
 * Leave a place for the list at `path`: back in history when the entry before this one is that
 * list, as it opened this place and only cursor moves (which replace) came since; else to it, as
 * a step forward or, with `replace`, in this one's place. `query` is what the list should hold on
 * arrival, such as the card the place was last on.
 */
export function backToList(
  path: string,
  query: Record<string, string | undefined>,
  opts?: { replace?: boolean },
) {
  if (openers.get(history!.location.state.__TSR_index) !== path) return navigate(path, query, opts)
  const stop = history!.subscribe(({ location }) => {
    stop()
    if (location.pathname !== path) return
    const q = new URLSearchParams(location.search)
    const was = q.toString()
    for (const [k, v] of Object.entries(query)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    if (q.toString() !== was) navigate(path, Object.fromEntries(q), { replace: true })
  })
  history!.back()
}

/** Go somewhere in place of the address now, as a redirect does: Back skips the address left. */
export function redirectTo(path: string) {
  void router!.navigate({ href: path, replace: true })
}

/** Change some query values on the current path, keeping the rest. */
export function setQuery(changes: Record<string, string | undefined>) {
  void changeQuery(changes)
}

/**
 * The same, settling once the new address is drawn: for a view transition to wait on. With
 * `replace` it takes the place of the address now, so Back skips it.
 */
export function changeQuery(
  changes: Record<string, string | undefined>,
  opts?: { replace?: boolean },
) {
  const { path, query } = current()
  const q = new URLSearchParams(query)
  for (const [k, v] of Object.entries(changes)) {
    if (v) q.set(k, v)
    else q.delete(k)
  }
  return router!.navigate({ href: href(path, Object.fromEntries(q)), replace: opts?.replace })
}

/** A plain click on a link (no modifier key) does `then` in its place; any other opens the link. */
export const plainClick = (then: () => void) => (e: React.MouseEvent) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  then()
}

/** Where the plain link around `target` goes, if it is one to this origin that opens in this tab. */
export function inAppLink(target: EventTarget | null) {
  const a = (target as Element | null)?.closest?.('a[href]')
  if (
    !(a instanceof HTMLAnchorElement) ||
    (a.target && a.target !== '_self') ||
    a.hasAttribute('download')
  )
    return null
  const url = new URL(a.href)
  return url.origin === window.location.origin ? url : null
}

/**
 * A plain link (`<a href="/context">`) moves inside the app without loading the page again: a click with no modifier key, on a link to this origin that opens in this tab. A
 * link to a place on the same page (#section) is left to the browser. Pointing at one, focusing it
 * or touching it fetches the page's code before the click. The router's own preloading only
 * watches its <Link>, which the app does not use.
 */
export function useInAppLinks() {
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const url = inAppLink(e.target)
      if (!url) return
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      )
        return
      e.preventDefault()
      void router!.navigate({ href: `${url.pathname}${url.search}${url.hash}` })
    }
    // Moving across a link's icon and label is one intent.
    let intended = ''
    const onIntent = (e: Event) => {
      const url = inAppLink(e.target)
      const to = url ? `${url.pathname}${url.search}` : ''
      if (url && to !== intended)
        void router!.preloadRoute({
          to: url.pathname,
          search: Object.fromEntries(url.searchParams),
        })
      intended = to
    }
    const intents = ['pointerover', 'focusin', 'touchstart']
    document.addEventListener('click', onClick)
    for (const intent of intents) document.addEventListener(intent, onIntent, { passive: true })
    return () => {
      document.removeEventListener('click', onClick)
      for (const intent of intents) document.removeEventListener(intent, onIntent)
    }
  }, [])
}
