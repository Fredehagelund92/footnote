// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { createQueryClient } from '@/api/query-client'
import { queryKeys, useWrite } from '@/api/queries'

// A refused change of what a family means leaves the dialog's revision stale: the definitions are
// read again, so reopening it sends the revision someone else left.

const bindings = vi.hoisted(() => ({ setFamilyMeaning: vi.fn() }))
vi.mock('@/api', () => ({ api: bindings }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function change(error: unknown) {
  bindings.setFamilyMeaning.mockRejectedValueOnce(error)
  const client = createQueryClient({ onSignedOut: vi.fn() })
  client.setQueryData(queryKeys.definitions, ['read before'])
  let write: ReturnType<typeof useWrite> = null as never
  function Probe() {
    write = useWrite()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)))
  })
  await write('setFamilyMeaning', {
    name: 'Revenue',
    choice: 'auto',
    revision: 0,
  }).catch(() => null)
  act(() => root.unmount())
  return client.getQueryState(queryKeys.definitions)!.isInvalidated
}

describe('useWrite of what a family means', () => {
  it('reads the definitions again when the change is refused as a conflict', async () => {
    expect(await change(new ApiError('conflict', 'Someone changed it.', { status: 409 }))).toBe(
      true,
    )
  })

  it('leaves them be when it fails for another reason', async () => {
    expect(await change(new ApiError('forbidden', 'Not yours.', { status: 403 }))).toBe(false)
  })
})
