import { describe, expect, it } from 'vitest'
import { DESCRIPTION_COPY_MAX, descriptionCopy } from '../../../src/domain/definition-helpers.ts'

// A description over 500 characters is kept as a copy that ends on a whole word with an ellipsis,
// never mid-word ("use `commerci"), inside the 500 a screen may show (CON-207).

/** Filler to put a description's end just past the 500. */
const lead = (length: number) => 'a'.repeat(length - 1) + ' '

describe('descriptionCopy', () => {
  it('keeps a description that fits as it is', () => {
    expect(descriptionCopy(null)).toEqual({ copy: null, cut: false })
    expect(descriptionCopy('')).toEqual({ copy: null, cut: false })
    const fits = `${lead(490)}fits whole`
    expect(fits).toHaveLength(DESCRIPTION_COPY_MAX)
    expect(descriptionCopy(fits)).toEqual({ copy: fits, cut: false })
  })

  it('cuts a long one at its last whole word, with an ellipsis', () => {
    const { copy, cut } = descriptionCopy(`${lead(480)}and a marketplace order counts only`)
    expect(cut).toBe(true)
    expect(copy).toBe(`${lead(480)}and a marketplace…`)
    expect(Array.from(copy!).length).toBeLessThanOrEqual(DESCRIPTION_COPY_MAX)
  })

  it('keeps a word the cut ends right after', () => {
    // The 500th character is the space after "order".
    const text = `${lead(494)}order and more words`
    expect(Array.from(text)[DESCRIPTION_COPY_MAX - 1]).toBe(' ')
    expect(descriptionCopy(text).copy).toBe(`${lead(494)}order…`)
  })

  it('never ends after a comma or inside a code span it cannot close', () => {
    expect(descriptionCopy(`${lead(488)}refunds, taxes and more`).copy).toBe(`${lead(488)}refunds…`)
    expect(descriptionCopy(`${lead(490)}as \`commission_eur\` and more`).copy).toBe(
      `${lead(490)}as…`,
    )
    expect(descriptionCopy(`${lead(480)}as \`net\` and \`gross revenue\` here`).copy).toBe(
      `${lead(480)}as \`net\` and…`,
    )
  })

  it('never ends on a full stop before its ellipsis', () => {
    expect(descriptionCopy(`${lead(488)}for review. A marketplace order`).copy).toBe(
      `${lead(488)}for review…`,
    )
  })

  it('cuts one long word where it must', () => {
    const { copy } = descriptionCopy('x'.repeat(600))
    expect(copy).toBe(`${'x'.repeat(DESCRIPTION_COPY_MAX - 1)}…`)
  })

  it('counts characters, not code units', () => {
    const { copy } = descriptionCopy(`${'é'.repeat(300)} ${'€'.repeat(300)}`)
    expect(copy).toBe(`${'é'.repeat(300)}…`)
  })
})
