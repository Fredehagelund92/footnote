import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  passageDiff,
  passageStats,
  safeHref,
  type Passage,
  type PassageRow,
} from '@/lib/passage-diff'
import { reviewFor } from '@/api/mock/data/review'

// K2, the text in two columns: the done-when lines of the slice, on the rows the view draws.

const marked = (p: Passage | null) =>
  p?.runs.filter((r) => r.changed && r.text.trim()).map((r) => r.text) ?? []
const words = (p: Passage | null) => p?.runs.map((r) => r.text).join('') ?? null
const sides = (rows: PassageRow[]) => rows.map((r) => [words(r.before), words(r.after)])

describe("the comparison's text", () => {
  it('draws one changed word as one struck word and one underlined word', () => {
    const rows = passageDiff('Orders fell to 312 a day.', 'Orders fell to 340 a day.')
    expect(rows).toHaveLength(1)
    expect(marked(rows[0]!.before)).toEqual(['312'])
    expect(marked(rows[0]!.after)).toEqual(['340'])
    expect(rows[0]!.changed).toBe(true)
  })

  it('marks an added sentence only on the right, a removed one only on the left', () => {
    const was = 'There are no stores in Norway, so the webshop was the only way to buy there.'
    const added = passageDiff(was, `${was} Marketplace orders stopped too.`)
    expect(marked(added[0]!.before)).toEqual([])
    expect(marked(added[0]!.after)).toEqual(['Marketplace orders stopped too.'])

    const removed = passageDiff(`${was} Marketplace orders stopped too.`, was)
    expect(marked(removed[0]!.before)).toEqual(['Marketplace orders stopped too.'])
    expect(marked(removed[0]!.after)).toEqual([])
  })

  it('marks an added or removed passage whole, on its own side only', () => {
    const added = passageDiff('One.\n\nThree.', 'One.\n\nTwo is new here.\n\nThree.')
    expect(sides(added)).toEqual([
      ['One.', 'One.'],
      [null, 'Two is new here.'],
      ['Three.', 'Three.'],
    ])
    expect(marked(added[1]!.after)).toEqual(['Two is new here.'])

    const removed = passageDiff('One.\n\nTwo goes.\n\nThree.', 'One.\n\nThree.')
    expect(sides(removed)).toEqual([
      ['One.', 'One.'],
      ['Two goes.', null],
      ['Three.', 'Three.'],
    ])
    expect(marked(removed[1]!.before)).toEqual(['Two goes.'])
  })

  it('leaves a passage that stays the same without a mark', () => {
    const rows = passageDiff(
      'A rule stopped sales.\n\nParcels still arrived.',
      'A rule stopped all sales.\n\nParcels still arrived.',
    )
    expect(rows[1]).toMatchObject({ changed: false })
    expect(rows[1]!.before!.runs.some((r) => r.changed)).toBe(false)
    expect(rows[1]!.after!.runs.some((r) => r.changed)).toBe(false)
  })

  it('lines the two sides up passage by passage', () => {
    const rows = passageDiff(
      'Intro.\n\nOrders fell to almost nothing.\n\n- Parcels still arrived.\n- Compare within a side.',
      'Intro.\n\nOrders fell to under 20 a day.\n\nA new passage.\n\n- Parcels still arrived.\n- Compare within a side.',
    )
    expect(sides(rows)).toEqual([
      ['Intro.', 'Intro.'],
      ['Orders fell to almost nothing.', 'Orders fell to under 20 a day.'],
      [null, 'A new passage.'],
      ['Parcels still arrived.', 'Parcels still arrived.'],
      ['Compare within a side.', 'Compare within a side.'],
    ])
    expect(rows.map((r) => r.changed)).toEqual([false, true, true, false, false])
  })

  it('puts what went and what came between two same passages on shared rows', () => {
    const rows = passageDiff(
      'Start.\n\nThe feed was late.\n\nEnd.',
      'Start.\n\nCustoms set an end date for it.\n\nEnd.',
    )
    expect(sides(rows)).toEqual([
      ['Start.', 'Start.'],
      ['The feed was late.', 'Customs set an end date for it.'],
      ['End.', 'End.'],
    ])
    expect(marked(rows[1]!.before)).toEqual(['The feed was late.'])
    expect(marked(rows[1]!.after)).toEqual(['Customs set an end date for it.'])
  })

  it('keeps the lines of the stored text each passage takes, on its own side', () => {
    const rows = passageDiff('One.\n\nTwo\nwrapped.', 'One.\n\nNew.\n\nTwo\nwrapped.')
    expect(rows.map((r) => [r.before?.line, r.before?.last, r.after?.line, r.after?.last])).toEqual(
      [
        [1, 1, 1, 1],
        [undefined, undefined, 3, 3],
        [3, 4, 5, 6],
      ],
    )
  })

  it('keeps a mention whole, as the editor wrote it', () => {
    const token = '[@ id="term:Test account" label="accounts"]'
    const rows = passageDiff('Leaves out 312 accounts.', `Leaves out 340 ${token}.`)
    const mention = rows[0]!.after!.runs.find((r) => r.mention)
    expect(mention).toMatchObject({ mention: token, changed: true })
    expect(rows[0]!.after!.runs.map((r) => r.text).join('')).not.toContain('[@')
  })

  it('numbers the steps of a numbered list, and draws marks as the reader sees them', () => {
    const rows = passageDiff('1. First\n2. Second', '1. First\n2. **Second**')
    expect(rows.map((r) => r.after?.n)).toEqual([1, 2])
    expect(rows[1]!.after!.runs.find((r) => r.text === 'Second')).toMatchObject({
      marks: ['bold'],
    })
    expect(rows[1]!.after!.runs.map((r) => r.text).join('')).not.toContain('*')
  })

  it('counts the passages that changed and the words of each side', () => {
    const r = reviewFor('sug-ines')!
    const rows = passageDiff(r.source.before, r.source.after)
    expect(passageStats(rows)).toEqual({ changed: 1, words: { before: 31, after: 50 } })
    // The returns team's new sentence is marked on the right only, inside the same passage.
    expect(marked(rows[0]!.before)).toEqual(['312'])
    expect(marked(rows[0]!.after)[0]).toBe('340')
  })

  it('keeps a link only when a reader may follow it', () => {
    expect(safeHref('https://wiki.example/returns')).toBe('https://wiki.example/returns')
    expect(safeHref('mailto:data@example.com')).toBe('mailto:data@example.com')
    expect(safeHref('/context/itm_norway')).toBe('/context/itm_norway')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref(' JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,hi')).toBeNull()
    const rows = passageDiff(
      'See [the notice](javascript:alert(1)).',
      'See [the notice](https://customs.example/n).',
    )
    expect(rows[0]!.before!.runs.find((r) => r.text.includes('notice'))!.href).toBeNull()
    expect(rows[0]!.after!.runs.find((r) => r.text.includes('notice'))!.href).toBe(
      'https://customs.example/n',
    )
  })

  it('never loses a word: each side reads its whole text, in order', () => {
    const line = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,]{0,23}$/).filter((s) => !!s.trim())
    const text = fc
      .array(line, { minLength: 1, maxLength: 6 })
      .map((xs) => xs.map((x) => x.trim().replace(/\s+/g, ' ')).join('\n\n'))
    fc.assert(
      fc.property(text, text, (before, after) => {
        const rows = passageDiff(before, after)
        const side = (s: 'before' | 'after') =>
          rows.flatMap((r) => (r[s] ? [words(r[s])] : [])).join('\n\n')
        expect(side('before')).toBe(before)
        expect(side('after')).toBe(after)
        // A row with no change has no mark on either side.
        for (const r of rows.filter((x) => !x.changed))
          expect([...marked(r.before), ...marked(r.after)]).toEqual([])
      }),
    )
  })
})
