// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { inAppLink } from '@/lib/router'

// A plain link moves inside the app only to a page of the app: one to what the service answers on
// the same origin, such as Sign in with the company's provider, loads it.

function link(href: string, attributes: Record<string, string> = {}) {
  const a = document.createElement('a')
  a.href = href
  for (const [name, value] of Object.entries(attributes)) a.setAttribute(name, value)
  const label = document.createElement('span')
  a.append(label)
  return label
}

describe('a plain link', () => {
  it('to a page of the app moves inside it', () => {
    expect(inAppLink(link('/context?q=norway'))?.pathname).toBe('/context')
    expect(inAppLink(link('/apis-and-more'))?.pathname).toBe('/apis-and-more')
  })

  it('to what the service answers loads it', () => {
    for (const href of [
      '/api/v1/auth/oidc/start?returnTo=%2F',
      '/mcp',
      '/oauth/authorize',
      '/.well-known/oauth-authorization-server',
      '/health/ready',
      '/metrics',
    ])
      expect(inAppLink(link(href)), href).toBeNull()
  })

  it('to another origin, a new tab or a download is left to the browser', () => {
    expect(inAppLink(link('https://example.test/context'))).toBeNull()
    expect(inAppLink(link('/context', { target: '_blank' }))).toBeNull()
    expect(inAppLink(link('/context', { download: '' }))).toBeNull()
  })
})
