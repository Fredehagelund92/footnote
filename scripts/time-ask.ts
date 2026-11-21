import { appendFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

/*
  Ask's speed gate (docs/releasing.md), on a running install whose assistant is a real model:

    node scripts/time-ask.ts [address] [rounds]

  Each round opens a new chat in a new browser, as a first visit does, and times from the moment
  Enter is pressed until the answer's first word is on the page:
    - a first question, "What is net revenue?": within 4 s,
    - a follow-up with no read, "Who owns it?": within 2.5 s.
  It passes when 9 rounds in 10 (of `rounds`, rounded up) are within both, and says so in its exit
  code. A real model answers, so each round costs about USD 0.05 on the default model. Only a quiet
  machine gives numbers worth quoting: nothing else running beside the install.
*/

const address = process.argv[2] ?? 'http://localhost:8080'
const rounds = Number(process.argv[3] ?? 10)
const limit = 60_000

/** Each question, and the longest its first word may take. */
const TURNS = [
  { name: 'First question', question: 'What is net revenue?', within: 4000 },
  { name: 'Follow-up with no read', question: 'Who owns it?', within: 2500 },
] as const

/**
 * Milliseconds from Enter until the `n`th answer of the chat shows a word, timed in the page: from
 * the key's press to the first frame that draws a word.
 */
async function firstWord(page: Page, question: string, n: number) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click({ timeout: limit })
  await box.fill(question)
  const shown = page.evaluate(
    ({ n, limit }) =>
      new Promise<number | null>((resolve) => {
        let start = 0
        const frame = () => {
          const turn = document.querySelectorAll('[role="log"] [data-turn]')[n]
          const words = turn?.querySelector('[data-answer-words]')?.textContent ?? ''
          if (words.trim()) resolve(performance.now() - start)
          else if (performance.now() - start > limit) resolve(null)
          else requestAnimationFrame(frame)
        }
        document.addEventListener(
          'keydown',
          (event) => {
            if (event.key !== 'Enter') return
            start = performance.now()
            requestAnimationFrame(frame)
          },
          { capture: true, once: true },
        )
      }),
    { n, limit },
  )
  // The page listens for the key before it is pressed.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await box.press('Enter')
  const ms = await shown
  if (ms === null) throw new Error(`No word of "${question}" showed within ${limit / 1000} s.`)
  // The answer is whole, and Ask can be asked again, before the next question.
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({
    state: 'detached',
    timeout: limit,
  })
  return ms
}

const times: number[][] = TURNS.map(() => [])
const browser = await chromium.launch()
try {
  for (let round = 1; round <= rounds; round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    // The demo signs in on the first page, then Ask opens on a new chat.
    await page.goto(address)
    await page.getByRole('navigation').first().waitFor({ timeout: limit })
    await page.goto(new URL('/ask', address).href)
    await page.getByRole('textbox', { name: 'Ask a question' }).waitFor({ timeout: limit })
    const line: string[] = []
    for (const [i, turn] of TURNS.entries()) {
      const ms = await firstWord(page, turn.question, i)
      times[i]!.push(ms)
      line.push(`${turn.name.toLowerCase()} ${(ms / 1000).toFixed(2)} s`)
    }
    console.log(`round ${round}: ${line.join(', ')}`)
    await context.close()
  }
} finally {
  await browser.close()
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`
const needed = Math.ceil(rounds * 0.9)
const within = TURNS.map((turn, i) => times[i]!.filter((ms) => ms <= turn.within).length)
const table = [
  `| What | Within | Rounds within | Slowest | Each round |`,
  `| --- | --- | --- | --- | --- |`,
  ...TURNS.map(
    (turn, i) =>
      `| ${turn.name} | ${seconds(turn.within)} | ${within[i]} of ${rounds} | ${seconds(Math.max(...times[i]!))} | ${times[i]!.map(seconds).join(', ')} |`,
  ),
].join('\n')
const passed = within.every((n) => n >= needed)
const verdict = passed
  ? `Passed: ${needed} or more rounds of ${rounds} within both.`
  : `Failed: fewer than ${needed} rounds of ${rounds} within one of them.`
console.log(`\n${table}\n\n${verdict}`)
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Ask's speed gate, ${rounds} rounds\n\n${table}\n\n${verdict}\n\n`,
  )
if (!passed) process.exitCode = 1
