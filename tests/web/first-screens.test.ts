/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WORDS } from '@/lib/help-content'
import { kindHint } from '@/model/items'
import { setupSteps } from '@/lib/setup'

// The first screens say what Heed is for, and explain a word where it is first used (language audit
// L10, C10 and G2 to G33). What a person reads first is the README, Get started, Ask's empty screen
// and the Words at the top of Help.

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8')
const wordOf = (word: string) => WORDS.find(([w]) => w === word)![1]

describe('the first screens', () => {
  it('open the README with the problem, not with vendor words', () => {
    const intro = read('README.md').split('### Stop AI agents misreading your numbers.')[1]!
    const lead = intro.split('<!--')[0]!
    expect(lead).toContain('AI tools guess when they do not know why a number moved.')
    expect(lead).toContain('the people who know write it down once, and an owner checks it')
    expect(lead).not.toMatch(/context layer|over MCP/)
  })

  it('open Get started with what the app is for, in its line and its first sentence', () => {
    const page = read('docs/help/get-started.md')
    const line = 'Here you write down what your numbers mean, so AI tools stop guessing.'
    expect(page).toContain(`line: ${line}`)
    expect(page.split('---\n')[2]!.trimStart()).toMatch(new RegExp(`^${line}`))
    expect(page).not.toContain('From an empty workspace')
  })

  it('tell Ask’s empty screen what to ask, and what an AI agent is', () => {
    const ask = read('src/web/pages/ask.tsx').replace(/\s+/g, ' ')
    expect(ask).toContain("'Ask what is written about a number, such as orders in Norway'")
    expect(ask).toContain('AI agent (an AI tool such as Claude or Cursor)')
    expect(ask).not.toContain('the way an agent gets it')
  })

  it('explain a word once, where it is first used', () => {
    expect(setupSteps.find((s) => s.id === 'domain')!.description).toMatch(
      /^A domain is a part of the business with an owner, such as Sales\./,
    )
    expect(read('src/web/components/heed/records-answer.tsx')).toContain(
      'From the app&apos;s own list of what was written and changed. Not from your sales data.',
    )
    expect(read('src/web/pages/observability/overview.tsx')).toContain(
      'A topic is what agents asked about: a metric, a market and a month.',
    )
    expect(read('src/web/pages/settings.tsx')).toContain(
      'Saved questions answered by a real AI model, then judged.',
    )
    expect(read('src/web/pages/editor.tsx')).toContain(
      'Add a metric, or a dimension such as market',
    )
    expect(kindHint.note).not.toMatch(/definition/)
  })

  it('give Help’s Words the metric, dimension, term and Don’t conclude lines, and list them first', () => {
    const definition = wordOf('Definition')
    expect(definition).toContain('A metric is a number you track, such as Orders.')
    expect(definition).toContain('A dimension is a way to split a number, such as by market.')
    expect(definition).toContain('A term is a word your company uses, such as Peak season')
    expect(wordOf("Don't conclude")).toContain(
      'Example: do not say the customs rule caused the drop.',
    )
    const help = read('src/web/pages/help.tsx')
    expect(help.indexOf('<Words q={q} />')).toBeLessThan(help.indexOf('<AnswerLines q={q} />'))
  })
})
