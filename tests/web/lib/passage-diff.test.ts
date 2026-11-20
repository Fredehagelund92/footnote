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
    const rows = passageDiff('Leaves out 312 people.', `Leaves out 340 ${token}.`)
    const mention = rows[0]!.after!.runs.find((r) => r.mention)
    expect(mention).toMatchObject({ mention: token, changed: true, link: null })
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
    expect(passageStats(rows)).toEqual({
      changed: 1,
      reworded: 1,
      words: { before: 31, after: 50 },
    })
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

// K3, a new look, a move and a link in the text: the kinds the review's difference tells apart that
// keep the words get marks of their own, never a word struck and one added.
describe('the changes that keep the words', () => {
  const struck = (rows: PassageRow[]) =>
    rows.flatMap((r) => [...marked(r.before), ...marked(r.after)])

  it('reads the same words made bold as a new look, not words changed', () => {
    const rows = passageDiff(
      'The webshop was the only way to buy there.',
      'The webshop was **the only way to buy there**.',
    )
    expect(struck(rows)).toEqual([])
    expect(rows[0]).toMatchObject({ changed: true, words: false, stop: true })
    const look = rows[0]!.after!.runs.find((r) => r.look)!
    expect(look).toMatchObject({ text: 'the only way to buy there', marks: ['bold'] })
    expect(look.look).toEqual({ added: ['bold'], removed: [] })
    // The same words on the left say what they lose.
    expect(rows[0]!.before!.runs.find((r) => r.look)!.look).toEqual({
      added: [],
      removed: ['bold'],
    })
    expect(passageStats(rows)).toMatchObject({ changed: 1, reworded: 0 })
  })

  it('reads a list made numbered as a new shape of the same words', () => {
    const r = reviewFor('sug-ines-format')!
    const rows = passageDiff(r.source.before, r.source.after)
    expect(struck(rows)).toEqual([])
    expect(rows.map((x) => x.after?.was?.type ?? null)).toEqual([null, 'bullet', 'bullet'])
    expect(rows.map((x) => x.after?.n ?? null)).toEqual([null, 1, 2])
    expect(passageStats(rows)).toMatchObject({ changed: 3, reworded: 0 })
  })

  it('marks a moved step once on each side, neither struck nor added, counted once', () => {
    const r = reviewFor('sug-ines-order')!
    const rows = passageDiff(r.source.before, r.source.after)
    expect(struck(rows)).toEqual([])
    const left = rows.filter((x) => x.before?.moved)
    const right = rows.filter((x) => x.after?.moved)
    expect(left).toHaveLength(1)
    expect(right).toHaveLength(1)
    expect(left[0]!.before!.moved).toEqual({ up: true, steps: { from: 2, to: 1 } })
    expect(words(right[0]!.after)).toBe(words(left[0]!.before))
    // The place it left is marked but is no stop of its own.
    expect(passageStats(rows)).toMatchObject({ changed: 1, reworded: 0 })
    expect(rows.filter((x) => x.stop)).toEqual(right)
  })

  it('reads words made a link, or a link with a new address, as a link', () => {
    const added = passageDiff('See the notice.', 'See [the notice](https://customs.example/n).')
    expect(struck(added)).toEqual([])
    expect(added[0]!.after!.runs.find((r) => r.link)).toMatchObject({
      text: 'the notice',
      link: 'added',
    })
    const moved = passageDiff(
      'See [the notice](https://customs.example/old).',
      'See [the notice](https://customs.example/new).',
    )
    expect(moved[0]!.after!.runs.find((r) => r.link)!.link).toBe('address')
    const token = '[@ id="term:Test account" label="test accounts"]'
    const mention = passageDiff('It leaves out test accounts.', `It leaves out ${token}.`)
    expect(struck(mention)).toEqual([])
    expect(mention[0]!.after!.runs.find((r) => r.mention)).toMatchObject({
      mention: token,
      link: 'added',
      changed: false,
    })
    expect(mention[0]!.before!.runs.find((r) => r.link)!.text).toBe('test accounts')
    expect(passageStats(mention)).toMatchObject({ changed: 1, reworded: 0 })
  })

  it('keeps a deleted passage and a moved one on different rows, two changes', () => {
    const rows = passageDiff(
      'Alpha first.\n\nDelete this one.\n\nBeta middle.\n\nMoved last.',
      'Alpha first.\n\nMoved last.\n\nBeta middle.',
    )
    expect(rows.filter((r) => r.stop)).toHaveLength(2)
    expect(passageStats(rows).changed).toBe(2)
    const deleted = rows.find((r) => words(r.before) === 'Delete this one.')!
    expect(deleted.after).toBeNull()
    expect(deleted.stop).toBe(true)
    const came = rows.find((r) => words(r.after) === 'Moved last.')!
    expect(came.before).toBeNull()
    expect(came.after!.moved).toBeTruthy()
    expect(came).not.toBe(deleted)
  })

  it('reads a label with markup as its words, not as markup', () => {
    const star = '[@ id="metric:b" label="Revenue*"]'
    const rows = passageDiff(
      'Use *[@ id="metric:b" label="Revenue*"] only* here.',
      `Use ${star} here.`,
    )
    const mention = rows[0]!.after!.runs.find((r) => r.mention)
    expect(mention).toMatchObject({ mention: star })
    expect(rows[0]!.after!.runs.map((r) => r.text).join('')).not.toContain('](')
  })

  it('reads words that become a mention with brackets in its label as a link', () => {
    const token = '[@ id="metric:eur" label="Revenue (EUR)"]'
    const rows = passageDiff('Look at Revenue (EUR) today.', `Look at ${token} today.`)
    expect(rows[0]!.words).toBe(false)
    expect(rows[0]!.before!.runs.some((r) => r.changed)).toBe(false)
    expect(rows[0]!.after!.runs.find((r) => r.mention)).toMatchObject({
      mention: token,
      link: 'added',
    })
  })
})
