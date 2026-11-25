import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { run } from '../../src/cli/commands.ts'
import {
  builtFromQuestions,
  capRefusal,
  proveFlags,
  proveUsage,
  readProofFile,
  saidYes,
  stillSealed,
} from '../../src/server/run-prove.ts'

/*
  `footnote prove` without a database or a model: its options, the cap and the yes a real run
  needs before any call, the question file, and the command-line tool handing the command on.
  tests/integration/prove.test.ts runs it on a database.
*/

const dir = mkdtempSync(join(tmpdir(), 'footnote-prove-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the options', () => {
  it('asks three tries on the scripted model unless told otherwise', () => {
    expect(proveFlags([])).toEqual({ tries: 3, real: false, cap: null })
    expect(
      proveFlags(['--questions', 'mine.yaml', '--tries', '1', '--real', '--cap', '25']),
    ).toEqual({ tries: 1, real: true, cap: 25_000_000, questions: 'mine.yaml' })
    expect(proveFlags(['--cap', '0.5'])).toMatchObject({ cap: 500_000 })
  })

  it('refuses tries and caps that are not numbers it can use, and options it does not have', () => {
    for (const args of [
      ['--tries', '0'],
      ['--tries', '2.5'],
      ['--tries', '11'],
      ['--cap', '-1'],
      ['--cap', 'lots'],
      ['--cap', 'Infinity'],
      ['--cap', '1e30'],
      ['--cap', '10001'],
      ['--yes'],
      ['extra'],
    ])
      expect(proveFlags(args), args.join(' ')).toBeNull()
  })
})

describe('a real run', () => {
  it('needs a cap at or above the estimate, and says the cap that would do', () => {
    expect(capRefusal(7_400_000, 25_000_000)).toBeNull()
    expect(capRefusal(7_400_000, 7_400_000)).toBeNull()
    expect(capRefusal(7_400_000, 5_000_000)).toBe(
      'Estimated cost: USD 7.40. Run again with --cap 7.40 or more.',
    )
    expect(capRefusal(7_400_000, null)).toBe(
      'Estimated cost: USD 7.40. Run again with --cap 7.40 or more.',
    )
  })

  it('goes on only after a yes', () => {
    for (const answer of ['yes', 'Y', ' y\n', 'YES']) expect(saidYes(answer), answer).toBe(true)
    for (const answer of ['', 'no', 'yess', 'sure', 'y es'])
      expect(saidYes(answer), answer).toBe(false)
  })
})

describe('the question file', () => {
  it("reads the built-from lab's questions: reasons one step down, notes not to tell, nothing written", async () => {
    const read = await readProofFile(builtFromQuestions)
    if (!('questions' in read)) throw new Error(read.problems.join('; '))
    const { questions } = read
    expect(questions).toHaveLength(12)
    expect(questions.filter((q) => q.reasons.length)).toHaveLength(6)
    expect(questions.filter((q) => !q.reasons.length && q.wrong.length)).toHaveLength(3)
    expect(questions.filter((q) => !q.reasons.length && !q.wrong.length)).toHaveLength(3)
  })

  it('reads the template, and names where a file fails the format', async () => {
    const template = fileURLToPath(
      new URL('../../docs/templates/prove-questions.yaml', import.meta.url),
    )
    const read = await readProofFile(template)
    if (!('questions' in read)) throw new Error(read.problems.join('; '))
    expect(read.questions.map((q) => q.id)).toEqual([
      'orders-netherlands-july',
      'orders-united-kingdom-october',
      'orders-france-may',
      'orders-spain-october',
    ])
    const broken = join(dir, 'broken.yaml')
    writeFileSync(broken, 'questions:\n  - id: x\n')
    const unfit = await readProofFile(broken)
    expect(
      'problems' in unfit && unfit.problems.some((p) => p.startsWith('questions.0.id: ')),
    ).toBe(true)
    const missing = join(dir, 'none.yaml')
    expect(await readProofFile(missing)).toEqual({
      problems: [`Cannot read ${missing}: ENOENT`],
    })
    const notYaml = join(dir, 'tabs.yaml')
    writeFileSync(notYaml, 'questions: [\n')
    expect(await readProofFile(notYaml)).toEqual({
      problems: [`${notYaml} is neither YAML nor JSON`],
    })
  })
})

describe('the command-line tool', () => {
  const io = () => {
    const out = { stdout: '', stderr: '' }
    return {
      out,
      io: {
        stdout: (text: string) => void (out.stdout += text),
        stderr: (text: string) => void (out.stderr += text),
        env: { ...process.env },
      },
    }
  }

  it('hands prove and its own options on to the command', { timeout: 60_000 }, async () => {
    const refused = io()
    expect(await run(['prove', '--tries', 'many'], refused.io)).toBe(2)
    expect(refused.out.stderr.trim()).toBe(proveUsage)
    // Without a file and before the invented company's questions are opened, nothing is asked.
    const sealed = io()
    expect(await run(['prove'], sealed.io)).toBe(1)
    expect(sealed.out.stderr.trim()).toBe(stillSealed)
    const broken = join(dir, 'broken-cli.yaml')
    writeFileSync(broken, 'questions: []\n')
    const unfit = io()
    expect(await run(['prove', '--questions', broken], unfit.io)).toBe(1)
    expect(unfit.out.stderr).toMatch(/does not fit the question format:\n {2}questions: /)
  })

  it('lists prove in its help', async () => {
    const help = io()
    expect(await run(['--help'], help.io)).toBe(0)
    expect(help.out.stdout).toMatch(/^ {2}prove {15}Ask the same questions three ways/m)
  })
})
