import { describe, expect, it } from 'vitest'
import { formatDraft } from '../../../src/domain/draft.ts'
import { itemVersionSchema, publishable } from '../../../src/domain/item-version.ts'
import { limits } from '../../../src/domain/proposal-rules.ts'
import {
  linksToConfirm,
  QUESTION_WORDS,
  monthWindow,
  questionPath,
  titleOfWords,
} from '../../../src/domain/questions.ts'
import { version } from './fixtures.ts'

/*
  Ask someone who knows (src/domain/questions.ts): a person who knows what happened may send it
  without a link to a source, and the owner adds or confirms one before publishing.
*/

describe('a version without a source', () => {
  it('is sent only from a question link, and is never publishable', () => {
    const question = version({ createdVia: 'question', evidence: [] })
    expect(itemVersionSchema.safeParse(question).success).toBe(true)
    expect(publishable(question)).toBe(false)
    for (const createdVia of ['form', 'chat', 'mcp', 'import', 'command_line'] as const) {
      const parsed = itemVersionSchema.safeParse(version({ createdVia, evidence: [] }))
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['evidence']])
    }
    expect(publishable(version())).toBe(true)
  })

  it('keeps the link its sender gave in the draft, for the owner to confirm', () => {
    const { proposerId: _p, createdVia: _c, mentions: _m, ...draft } = version()
    const given = {
      ...draft,
      summaryMarkup: undefined,
      summary: 'Online sales stopped in Norway.',
      evidence: [{ url: 'https://carrier.example/notice', quote: '', date: '2026-11-25' }],
    }
    // From the question page the version goes out with the sources that are complete: none yet.
    const sent = formatDraft(given, 'alice', 'question')
    expect(sent.findings).toEqual([])
    expect(sent.version?.evidence).toEqual([])
    expect(linksToConfirm(given)).toEqual(['https://carrier.example/notice'])
    // From the editor the same draft is refused until the sentence is there.
    expect(formatDraft(given, 'alice', 'form').version).toBeNull()
    // Confirmed with a sentence from it, it is a source like any other.
    const confirmed = {
      ...given,
      evidence: [{ ...given.evidence[0]!, quote: 'Deliveries stop for three days.' }],
    }
    expect(linksToConfirm(confirmed)).toEqual([])
    expect(publishable(formatDraft(confirmed, 'alice', 'question').version!)).toBe(true)
  })
})

describe('the question page', () => {
  it('opens on the topic month, end exclusive', () => {
    expect(monthWindow('2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-11-01' })
    expect(monthWindow('2026-12-01')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
    expect(monthWindow('2028-02-01')).toEqual({ start: '2028-02-01', end: '2028-03-01' })
    expect(questionPath('a1')).toBe('/question/a1')
    // What a person writes there is what agents read first.
    expect(QUESTION_WORDS).toBe(limits.summary)
  })

  it("titles a suggestion by the person's first sentence", () => {
    expect(
      titleOfWords('A strike at the carrier stopped deliveries for three days.  Orders waited.'),
    ).toBe('A strike at the carrier stopped deliveries for three days.')
    expect(titleOfWords('  No full stop here ')).toBe('No full stop here')
    const long = titleOfWords('word '.repeat(80))
    expect([...long]).toHaveLength(200)
    expect(long.endsWith('…')).toBe(true)
  })
})
