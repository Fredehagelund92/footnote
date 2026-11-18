import { beforeEach, vi } from 'vitest'
import { footnoteApiMethods, type FootnoteApi } from '@/api/client'
import { createMockApi } from '@/api/mock'
import { describeFootnoteApi } from '../conformance/footnote-api'

// The mock binding answers every method. The same suite runs against the http binding in
// tests/web/integration/http-api.test.ts.
let api: FootnoteApi
beforeEach(() => {
  api = createMockApi().api
})

describeFootnoteApi('mock binding', () => api, {
  person: 'Jon Abara',
  wired: footnoteApiMethods,
  colleague: 'Tomas Eriksen',
  repository: { address: 'https://git.example/larchwood/handbook', token: null },
  bystander: 'Ines Duarte',
  // The mock's Undo reads the browser's clock, which a journey moves as this does.
  afterUndoWindow: async (run) => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60 * 60 * 1000 })
    try {
      await run()
    } finally {
      vi.useRealTimers()
    }
  },
})
