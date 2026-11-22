// @vitest-environment jsdom
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { ACTIONS, actionIds, type ActionOffer, type Doer } from '@domain/actions'
import { mayOpenSettings } from '@/lib/settings-access'

// The route tree loads the app's skeleton, which asks the document to load its font.
vi.stubGlobal('document', Object.assign(document, { fonts: { load: () => Promise.resolve([]) } }))
const { routeTree } = await import('../../src/web/routeTree.gen')

// The quick actions' catalogue (FR-719.10) keeps in step with the screens: each action's role rule,
// where it opens and who is told to do it.

const people: Record<string, Doer> = {
  admin: { admin: true, owns: [] },
  'owner of one domain': { admin: false, owns: ['area_sales'] },
  'owner of two domains': { admin: false, owns: ['area_sales', 'area_support'] },
  member: { admin: false, owns: [] },
}

const family = (domain: string | null): ActionOffer['family'] => ({
  name: 'Revenue',
  domain,
  owners: ['Jon Abara'],
})

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ['/'] }),
})

/** Whether the app's router resolves an address to a route of its own, not the not-found route. */
const resolves = (path: string) =>
  router.matchRoutes(path, {}).some((m) => m.routeId !== '__root__' && !m.routeId.endsWith('/$'))

describe('the quick actions catalogue', () => {
  it('has a label, a rule, a target and a doer for every id and every kind of person', () => {
    expect(router.matchRoutes('/no/such/page', {}).some((m) => m.routeId.endsWith('/$'))).toBe(true)
    for (const id of actionIds)
      for (const [who, me] of Object.entries(people)) {
        const offer: ActionOffer = { id, family: family('domain:area_sales') }
        const action = ACTIONS[id]
        expect(typeof action.may(me, offer), `${id} for ${who}`).toBe('boolean')
        expect(action.label(me), `${id} for ${who}`).not.toBe('')
        expect(action.doneBy(offer), id).toBeDefined()
        const target = action.target(me, offer)
        if ('path' in target) {
          expect(resolves(target.path), `${id} opens ${target.path}`).toBe(true)
          if (action.may(me, offer))
            expect(mayOpenSettings(target.path, me), `${id} for ${who}`).toBe(true)
        } else expect(target).toEqual({ dialog: 'connect' })
      }
  })

  it("lets a family's actions to an admin and the owners of its domain, and to nobody else", () => {
    for (const id of ['pick_usual_variant', 'family_meaning'] as const) {
      const offer = (domain: string | null): ActionOffer => ({ id, family: family(domain) })
      expect(ACTIONS[id].may(people.admin!, offer('domain:area_sales'))).toBe(true)
      expect(ACTIONS[id].may(people['owner of one domain']!, offer('domain:area_sales'))).toBe(true)
      expect(ACTIONS[id].may(people['owner of one domain']!, offer('domain:area_support'))).toBe(
        false,
      )
      expect(ACTIONS[id].may(people.member!, offer('domain:area_sales'))).toBe(false)
    }
  })

  it('leaves a family whose domain is unknown to an admin: an owner is told who does it', () => {
    for (const id of ['pick_usual_variant', 'family_meaning'] as const) {
      const offer: ActionOffer = { id, family: family(null) }
      expect(ACTIONS[id].may(people.admin!, offer)).toBe(true)
      for (const who of ['owner of one domain', 'owner of two domains', 'member'])
        expect(ACTIONS[id].may(people[who]!, offer), who).toBe(false)
      expect(ACTIONS[id].doneBy(offer)).toMatchObject({ by: 'owners', domain: null, admins: true })
    }
  })
})
