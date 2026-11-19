import * as React from 'react'
import { useRouterState, type AnyRouter } from '@tanstack/react-router'

// The app's addresses are TanStack Router file routes (routes/), each with its search params
// validated (lib/search.ts). Pages read and change the address through this module: the path, its
// parts and the validated query, as one value.

export type Route = { path: string; parts: string[]; query: URLSearchParams }

let router: AnyRouter | undefined

/** The router every navigation goes through; main.tsx binds it once, before the first render. */
export function bindRouter(r: AnyRouter) {
  router = r
}

/**
 * The address an invite link or a refused company sign-in names after `#/`
 * (`/#/signin?invite=...`, `/#/signin?error=not_allowed`), as the path and search the router
 * reads; null for any other address. The fragment keeps an invite's token out of every request,
 * and main.tsx moves it into the path in the browser alone, before the router first reads it.
 */
export function addressInFragment(location: { pathname: string; search: string; hash: string }) {
  if (location.pathname !== '/' || location.search || !/^#\/[^/\\]/.test(location.hash)) return null
  return location.hash.slice(1)
}

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

export function href(path: string, query?: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v)
  const s = q.toString()
  return `${path}${s ? `?${s}` : ''}`
}

export function navigate(path: string, query?: Record<string, string | undefined>) {
  void router!.navigate({ href: href(path, query) })
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

/**
 * The addresses the service answers on the web app's origin, never a page of the app: a link to
 * one, such as Sign in with your company's provider (/api/v1/auth/oidc/start), loads it.
 */
const SERVICE_PATHS = /^\/(api|mcp|oauth|health|metrics|\.well-known)(\/|$)/

/**
 * Where the plain link around `target` goes, if it is one to a page of the app on this origin that
 * opens in this tab.
 */
export function inAppLink(target: EventTarget | null) {
  const a = (target as Element | null)?.closest?.('a[href]')
  if (
    !(a instanceof HTMLAnchorElement) ||
    (a.target && a.target !== '_self') ||
    a.hasAttribute('download')
  )
    return null
  const url = new URL(a.href)
  return url.origin === window.location.origin && !SERVICE_PATHS.test(url.pathname) ? url : null
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
