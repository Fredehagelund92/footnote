import { describe, expect, it } from 'vitest'
import { settingKeys } from '@contract/admin'
import { answerTestWords, SETTING_KEYS, settingGroups } from '@/model/settings'

describe('the tuning settings Advanced lists', () => {
  it('names every setting an administrator may change, each once', () => {
    expect([...SETTING_KEYS].sort()).toEqual([...settingKeys].sort())
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length)
  })

  it('says every setting in words, with what it does', () => {
    const groups = settingGroups(SETTING_KEYS.map((key) => ({ key, value: 1, changed: null })))
    expect(groups.some((g) => g.group === 'Other')).toBe(false)
    for (const r of groups.flatMap((g) => g.rows)) {
      expect(r.value, r.key).not.toBe('')
      expect(r.what, r.key).not.toBe('')
    }
  })
})

describe('answer tests that run on their own (decision 6)', () => {
  const tests = {
    on: false,
    version: 1,
    live: true,
    domains: 3,
    questions: 14,
    costMicros: 420_000,
    budgetMicros: 2_000_000,
    model: 'anthropic/claude-sonnet-5-5',
    judge: 'anthropic/claude-opus-5-5',
  }

  it('says what a run is estimated to cost before they are turned on', () => {
    const words = answerTestWords(tests)
    expect(words.state).toBe('Off')
    expect(words.hint).toMatch(/only when an Admin starts one/)
    expect(words.estimate).toEqual([
      'One run of every domain is estimated at $0.42, for 14 test questions in 3 domains.',
      'anthropic/claude-sonnet-5-5 answers them, and anthropic/claude-opus-5-5 judges the answers.',
      'They start every Monday, and after a change agents may notice, such as a source read that changed a definition. So each week costs at least that much.',
      'A run estimated above $2 still waits for an Admin.',
    ])
  })

  it('says a run costs nothing with no real model, or no test questions', () => {
    expect(answerTestWords({ ...tests, live: false }).estimate[0]).toBe(
      'No real AI model is connected, so these runs cost nothing here.',
    )
    expect(answerTestWords({ ...tests, questions: 0, domains: 0 }).estimate[0]).toBe(
      'No domain has test questions yet, so a run costs nothing now.',
    )
    expect(answerTestWords({ ...tests, on: true }).state).toBe('On')
  })
})
