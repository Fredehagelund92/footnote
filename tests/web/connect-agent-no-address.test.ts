// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/api/query-client'
import { DOCS_URL } from '@domain/brand'
import { ConnectAgent } from '@/components/connect-agent'

// Connect an agent on a workspace with no address for agents: the hosted online trial
// (docs/vercel.md), whose function serves no MCP server, or an install where an admin has not set
// one. One wording is true on both and links to both guides.

const bindings = vi.hoisted(() => ({
  getSettings: vi.fn(),
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

async function show() {
  bindings.getSettings.mockResolvedValue({ mcpAddress: null, tools: {}, connected: [] })
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
  await vi.waitFor(() => expect(host.querySelector('a')).not.toBeNull())
  return { text: host.textContent ?? '', links: [...host.querySelectorAll('a')] }
}

describe('Connect an agent with no address for agents', () => {
  it('says the online trial runs no agent connection and where an admin sets the address', async () => {
    const { text } = await show()
    expect(text).toContain('This workspace has no address for agents.')
    expect(text).toContain('The online trial does not run the agent connection')
    expect(text).toContain('an admin sets the address as MCP_RESOURCE_URL')
    expect(text).not.toContain('hosts this app')
  })

  it('links to running it on your own computer and to setting the address', async () => {
    const { links } = await show()
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `${DOCS_URL}/try-the-demo/`,
      `${DOCS_URL}/run-in-production/`,
    ])
  })

  it('has no em dash and no "we"', async () => {
    const { text } = await show()
    expect(text).not.toContain('—')
    expect(text).not.toMatch(/\bwe\b/i)
  })
})
