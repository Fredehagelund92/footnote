// @vitest-environment jsdom
import * as React from 'react'
import type { DomainId } from '@/model/items'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bindApi, type FootnoteApi } from '@/api'
import type { RaisedPage } from '@/model/alerts'

// Raised lately as a person reads it: another rule's page loading never wears the old rule's count
// or a negative Show more, and a read that fails says so with Retry instead of "nothing raised".

const world = vi.hoisted(() => ({ me: { admin: true, owns: [] as string[] } }))
vi.mock('@/lib/workspace', () => ({ useDomains: () => ({}), useMe: () => world.me }))
const { RaisedLately } = await import('@/pages/observability/alerts')

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
})

const row = (id: string): RaisedPage['raised'][number] =>
  ({
    id,
    title: `Card ${id}`,
    line: 'line',
    when: 'now',
    href: '/x',
  }) as RaisedPage['raised'][number]
const page = (ids: string[], total: number, notFound: number, next: string | null): RaisedPage => ({
  total,
  byRule: [
    { rule: 'due', count: total - notFound },
    { rule: 'gap', count: notFound },
  ],
  raised: ids.map(row),
  next,
})
const first = page(['a1', 'a2'], 12, 9, 'c1')

function mount(getRaised: FootnoteApi['getRaised'], domain?: DomainId) {
  bindApi({ getRaised } as unknown as FootnoteApi)
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const render = (d?: DomainId) =>
    act(() =>
      root!.render(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(RaisedLately, { first, empty: false, domain: d }),
        ),
      ),
    )
  render(domain)
  return render
}
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))
const text = () => host!.textContent ?? ''
const click = (el: Element) => act(() => (el as HTMLElement).click())
const button = (name: RegExp) =>
  [...host!.querySelectorAll('button')].find((b) => name.test(b.textContent ?? ''))!
const radio = (name: RegExp) =>
  [...host!.querySelectorAll('[role=radio]')].find((b) => name.test(b.textContent ?? ''))!

describe('Raised lately', () => {
  it('while another rule loads keeps the old rows without the new count or a Show more', async () => {
    let release!: (p: RaisedPage) => void
    mount(() => new Promise<RaisedPage>((r) => (release = r)))
    expect(text()).toContain('2 of 12, newest first')
    expect(button(/Show/)).toBeTruthy()

    click(radio(/Not found/))
    expect(host!.querySelectorAll('li a')).toHaveLength(2)
    expect(text()).not.toContain('All 9')
    expect(text()).not.toMatch(/-\d/)
    expect(button(/Show/)).toBeUndefined()

    release(page(['n1'], 12, 9, 'c2'))
    await flush()
    expect(text()).toContain('1 of 9, newest first')
    expect(button(/Show 8 more/)).toBeTruthy()
  })

  it("says a rule's first page failed, with Retry, not that nothing was raised", async () => {
    let down = true
    mount(({ rule }) =>
      rule && down ? Promise.reject(new Error('down')) : Promise.resolve(page(['n1'], 12, 9, null)),
    )
    click(radio(/Not found/))
    await flush()
    expect(host!.querySelector('[role=alert]')?.textContent).toContain("Couldn't load the raises")
    expect(text()).not.toContain('Nothing raised')
    down = false
    click(button(/Retry/))
    await flush()
    expect(host!.querySelector('[role=alert]')).toBeNull()
    expect(host!.querySelectorAll('li a')).toHaveLength(1)
  })

  it('says Show more failed and tries it again', async () => {
    let down = true
    mount(({ after }) =>
      after && down
        ? Promise.reject(new Error('down'))
        : Promise.resolve(after ? page(['a3'], 12, 9, null) : first),
    )
    click(button(/Show/))
    await flush()
    expect(text()).toContain("Couldn't refresh more raises")
    expect(host!.querySelectorAll('li a')).toHaveLength(2)
    down = false
    click(button(/Try again/))
    await flush()
    expect(text()).not.toContain("Couldn't refresh")
    expect(host!.querySelectorAll('li a')).toHaveLength(3)
  })

  it("with a domain chosen reads that domain's raises, their counts too", async () => {
    const asked: Parameters<FootnoteApi['getRaised']>[0][] = []
    mount((input) => {
      asked.push(input)
      return Promise.resolve(page(['s1'], 6, 5, null))
    }, 'sales')
    await flush()
    expect(asked).toEqual([{ domain: 'sales' }])
    expect(text()).toContain('1 of 6, newest first')
    click(radio(/Not found/))
    await flush()
    expect(asked.at(-1)).toEqual({ rule: 'gap', domain: 'sales' })
  })

  it('with a domain chosen and its read held shows loading, not empty or unfiltered counts', () => {
    mount(() => new Promise<RaisedPage>(() => {}), 'sales')
    expect(text()).toContain('Loading the raises')
    expect(text()).not.toContain('Nothing raised')
    expect(host!.querySelector('[role=radiogroup]')).toBeNull()
    expect(text()).not.toContain('12')
  })

  it('a domain change after a rule was chosen goes back to All with the new domain rows', async () => {
    const asked: Parameters<FootnoteApi['getRaised']>[0][] = []
    const render = mount((input) => {
      asked.push(input)
      return Promise.resolve(
        input.domain === 'marketing' ? page(['m1', 'm2'], 4, 1, null) : page(['s1'], 6, 5, null),
      )
    }, 'sales')
    await flush()
    click(radio(/Not found/))
    await flush()
    render('marketing')
    await flush()
    expect(asked.at(-1)).toEqual({ domain: 'marketing' })
    expect(host!.querySelectorAll('li a')).toHaveLength(2)
    expect(text()).not.toContain('Nothing raised')
    expect(radio(/^All/).getAttribute('aria-checked')).toBe('true')
    render('sales')
    await flush()
    expect(asked.at(-1)).toEqual({ domain: 'sales' })
    expect(radio(/^All/).getAttribute('aria-checked')).toBe('true')
  })

  it('draws a raise that points into Settings as a link for an admin, as plain words for an owner', () => {
    const settings = { ...first, raised: [{ ...row('s1'), href: '/settings/integrations/cube' }] }
    const show = (me: { admin: boolean; owns: string[] }) => {
      world.me = me
      bindApi({} as unknown as FootnoteApi)
      host = document.body.appendChild(document.createElement('div'))
      root = createRoot(host)
      const client = new QueryClient()
      act(() =>
        root!.render(
          React.createElement(
            QueryClientProvider,
            { client },
            React.createElement(RaisedLately, { first: settings, empty: false, domain: undefined }),
          ),
        ),
      )
    }
    show({ admin: false, owns: ['sales'] })
    expect(text()).toContain('Card s1')
    expect(host!.querySelectorAll('li a')).toHaveLength(0)
    act(() => root!.unmount())
    host!.remove()
    show({ admin: true, owns: [] })
    expect(host!.querySelector('li a')?.getAttribute('href')).toBe('/settings/integrations/cube')
  })
})
