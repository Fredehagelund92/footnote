import { beforeEach, vi } from 'vitest'
import { heedApiMethods, type HeedApi } from '@/api/client'
import { createMockApi } from '@/api/mock'
import { describeHeedApi } from '../conformance/heed-api'

// The mock binding answers every method. The same suite runs against the http binding in
// tests/web/integration/http-api.test.ts.
let api: HeedApi
beforeEach(() => {
  api = createMockApi().api
})

describeHeedApi('mock binding', () => api, {
  person: 'Jon Abara',
  wired: heedApiMethods,
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
