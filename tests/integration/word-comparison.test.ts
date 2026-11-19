import fc from 'fast-check'
import { expect, it } from 'vitest'
import { termWord } from '../../src/domain/terms.ts'
import { foundation, people } from './fixtures.ts'
import { testDatabase } from './support.ts'

const { client } = testDatabase()

/*
  One way to compare a word, in the write check, the database rule and the reader (FR-138): a
  word holds one meaning however it is written, and the database's function gives the service's
  own answer for every script a word is written in.
*/

/** The letters a word is written in: Latin with its accents, and the scripts people write words in. */
const scripts = [
  [0x20, 0x24f],
  [0x370, 0x3ff],
  [0x400, 0x52f],
  [0x591, 0x5ea],
  [0x620, 0x65f],
  [0x900, 0x97f],
  [0xe01, 0xe3a],
  [0x1e00, 0x1fff],
  [0x2000, 0x206f],
  [0x3000, 0x30ff],
  [0xac00, 0xac20],
  [0xff00, 0xffef],
]
const letter = fc
  .constantFrom(...scripts)
  .chain(([from, to]) => fc.integer({ min: from!, max: to! }))
  .map((code) => String.fromCodePoint(code))

it('holds a word to one meaning however it is written, and compares it as the service does', async () => {
  await foundation(client)
  const write = (name: string, meaning = 'A meaning.') =>
    client.query<{ id: string }>(
      `insert into terms (name, meaning, area_id, created_by, updated_by)
       values ($1, $2, 'finance', $3, $3) returning id::text`,
      [name, meaning, people.owner],
    )
  await write('Sales')
  for (const name of ['sales', ' SALÉS ', 'Sàles', 'Salés'])
    await expect(write(name)).rejects.toMatchObject({ code: '23505' })
  await expect(write('Peak Séason')).resolves.toBeTruthy()
  await expect(write('Péak  season')).rejects.toMatchObject({ code: '23505' })

  // The database and the service give one answer. Characters newer than the database's Unicode
  // version are outside this list: they read as written until PostgreSQL knows them.
  const samples = fc.sample(fc.array(letter, { minLength: 1, maxLength: 12 }), 2000)
  const words = [
    ...samples.map((letters) => letters.join('')),
    'Salés',
    ...['ΑΣ', 'ΑΣΑ', 'Σ', '.Σ', ' Σ', '1Σ', 'ας', 'ΑΣ.'],
    'Øre Æble Straße',
    'Net Revenue',
    '  Peak   Season ',
    'Net-revenue',
    'ﬁnance',
  ]
  const compared = await client.query<{ w: string; word: string }>(
    'select w, cl_term_word(w) as word from unnest($1::text[]) w',
    [words],
  )
  for (const { w, word } of compared.rows) expect(word, JSON.stringify(w)).toBe(termWord(w))
})
