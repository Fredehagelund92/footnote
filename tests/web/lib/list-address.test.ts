// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { listOf, listTo } from '@/lib/list'
import { backToList, bindRouter, cameFrom, navigate, openFromList } from '@/lib/router'
import { contextSearch, definitionsSearch } from '@/lib/search'

// A list's view lives in the address, and Back is honest about it: cursor moves take the place of
// the address, and leaving a place opened from a list goes back to the list's own entry.

describe('a list in the address', () => {
  it('reads a filter as the values the list knows, in its own order', () => {
    expect(listOf('due,nonsense,draft', ['draft', 'waiting', 'due'] as const)).toEqual([
      'draft',
      'due',
    ])
    expect(listOf(null, ['draft'] as const)).toEqual([])
    expect(listTo(['sales', 'finance'])).toBe('sales,finance')
    expect(listTo([])).toBeUndefined()
  })

  it('keeps the Context view: filters, words, sort, group and archived shown', () => {
    const view = {
      domain: 'sales,finance',
      status: 'due',
      kind: 'issue',
      show: 'conflicts',
      q: 'norway',
      sort: 'title',
      dir: 'desc',
      group: 'domain',
      archived: 'shown',
    }
    expect(contextSearch(view)).toEqual(view)
    expect(contextSearch({ dir: 'up', group: 'kind', archived: 'yes' })).toEqual({
      dir: undefined,
      group: undefined,
      archived: undefined,
    })
  })

  it('keeps the Definitions view, Families as the split lands on it', () => {
    const view = {
      show: 'families',
      domain: 'sales',
      status: 'no-context',
      synonyms: 'rows',
      q: 'revenue',
      sort: 'updated',
      dir: 'asc',
      group: 'none',
    }
    expect(definitionsSearch(view)).toEqual(view)
    expect(definitionsSearch({ show: 'all', group: 'domain' })).toEqual({
      show: undefined,
      group: undefined,
    })
  })
})

describe('the way back to a list', () => {
  const root = createRootRoute()
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/inbox' }),
    createRoute({ getParentRoute: () => root, path: '/inbox/$id/review' }),
    createRoute({ getParentRoute: () => root, path: '/context' }),
  ])
  const history = createMemoryHistory({ initialEntries: ['/context'] })
  const router = createRouter({ routeTree, history })
  bindRouter(router)
  beforeAll(() => router.load())
  const at = () => `${history.location.pathname}${history.location.search}`
  const settled = (href: string) => vi.waitFor(() => expect(at()).toBe(href))

  it('goes back to the entry it was opened from, on the place last open', async () => {
    navigate('/inbox', { card: 'a' })
    await settled('/inbox?card=a')
    const inbox = history.location.state.__TSR_index
    openFromList('/inbox/a/review')
    await settled('/inbox/a/review')
    // J in the review: the next one takes this one's place.
    navigate('/inbox/b/review', undefined, { replace: true })
    await settled('/inbox/b/review')

    backToList('/inbox', { card: 'b' })
    await settled('/inbox?card=b')
    expect(history.location.state.__TSR_index).toBe(inbox)
    expect(cameFrom()).toBe('/inbox/b/review')
  })

  it('goes forward to the list when it was not opened from it', async () => {
    navigate('/inbox/c/review')
    await settled('/inbox/c/review')
    const review = history.location.state.__TSR_index
    backToList('/inbox', { card: 'c' })
    await settled('/inbox?card=c')
    expect(history.location.state.__TSR_index).toBe(review + 1)
  })

  it('forgets a list once a step forward takes the place of what it opened', async () => {
    navigate('/inbox', { card: 'a' })
    await settled('/inbox?card=a')
    openFromList('/inbox/a/review')
    await settled('/inbox/a/review')
    history.back()
    await settled('/inbox?card=a')
    // A link from the list to the same review, not opened as from the list.
    navigate('/inbox/a/review')
    await settled('/inbox/a/review')
    const review = history.location.state.__TSR_index
    backToList('/inbox', { card: 'a' })
    await settled('/inbox?card=a')
    expect(history.location.state.__TSR_index).toBe(review + 1)
  })
})
