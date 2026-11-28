// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/api/query-client'
import type { SignInMethod } from '@/api/client'
import { DOCS_URL } from '@domain/brand'
import { ConnectAgent } from '@/components/connect-agent'

// Connect an agent on a workspace with no address for agents: the hosted demo (docs/vercel.md),
// whose function serves no MCP server. It says so and sends a visitor to run Footnote on their own
// computer, where an admin's setting would change nothing. Anywhere else, an admin sets the address.

const bindings = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getSignInMethod: vi.fn(),
}))
vi.mock('@/api', () => ({ api: bindings }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const host = document.createElement('div')
document.body.append(host)
let root: ReturnType<typeof createRoot> | undefined
afterEach(() => {
  act(() => root?.unmount())
  for (const binding of Object.values(bindings)) binding.mockReset()
})

async function show(demo: boolean) {
  bindings.getSettings.mockResolvedValue({ mcpAddress: null, tools: {}, connected: [] })
  bindings.getSignInMethod.mockResolvedValue({
    kind: 'picker',
    first: false,
    demo,
    profileLabel: null,
  } satisfies SignInMethod)
  root = createRoot(host)
  act(() => {
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client: createQueryClient() },
        React.createElement(
          React.Suspense,
          null,
          React.createElement(ConnectAgent, { inDialog: true }),
        ),
      ),
    )
  })
  await vi.waitFor(() => expect(host.querySelector('p')).not.toBeNull())
  // The sign-in method is read apart from the settings: wait for the words that depend on it.
  await vi.waitFor(() => expect(host.querySelector('a')).not.toBeNull())
  return { text: host.textContent ?? '', link: host.querySelector('a')! }
}

describe('Connect an agent with no address for agents', () => {
  it('tells a visitor of the hosted demo to run Footnote on their own computer', async () => {
    const { text, link } = await show(true)
    expect(text).toContain('This online trial does not run the agent connection')
    expect(text).toContain('run it on your own computer')
    expect(text).not.toContain('hosts this app')
    expect(text).not.toContain('MCP_RESOURCE_URL')
    expect(link.getAttribute('href')).toBe(`${DOCS_URL}/try-the-demo/`)
  })

  it('tells an install without one that an admin sets its address, and where', async () => {
    const { text, link } = await show(false)
    expect(text).toContain("Agents can't connect here yet: this workspace has no address for them.")
    expect(text).toContain('An admin sets it, as MCP_RESOURCE_URL, where the service runs.')
    expect(text).not.toContain('online trial')
    expect(link.getAttribute('href')).toBe(`${DOCS_URL}/run-in-production/`)
  })

  it('has no em dash and no "we"', async () => {
    for (const demo of [true, false]) {
      const { text } = await show(demo)
      expect(text).not.toContain('—')
      expect(text).not.toMatch(/\bwe\b/i)
      act(() => root?.unmount())
      root = undefined
    }
  })
})
