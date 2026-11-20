import { appendFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

/*
  How long the demo takes in a browser, on a running install (tests/image/quick-start.sh runs it
  on the images `docker compose up` started):

    node scripts/time-demo.ts [address] [rounds]

  Each round opens a new browser with nothing kept, as a first visit does, and times three
  things from the moment it acts:
    - the first page: the address opened until the Inbox shows what agents asked this week,
    - the Context list: /context opened until the count of the library and its first row show,
    - a scripted answer: the README's question sent on Ask until Checked and the customs rule show.
  The scripted models answer, so no model is called and nothing is spent. A real model's answer
  is not timed here: it needs a provider key (docs/model-providers.md, "Start on a real model").

  It prints each round and the median, and adds the table to $GITHUB_STEP_SUMMARY in CI. Only a
  quiet machine gives numbers worth quoting: nothing else running beside the install.
*/

const address = process.argv[2] ?? 'http://localhost:8080'
const rounds = Number(process.argv[3] ?? 5)
const limit = 120_000

const QUESTION = 'How did orders in Norway change in October 2026?'

/** Milliseconds from now until `done` resolves. */
async function timed(done: () => Promise<unknown>) {
  const start = performance.now()
  await done()
  return performance.now() - start
}

async function firstPage(page: Page) {
  return timed(async () => {
    await page.goto(address)
    await page.getByText(/This week agents asked \d+ times/).waitFor({ timeout: limit })
  })
}

async function contextList(page: Page) {
  return timed(async () => {
    await page.goto(new URL('/context', address).href)
    await page.getByText(/of 1,\d{3} context items/).waitFor({ timeout: limit })
    await page.getByRole('main').getByRole('row').nth(1).waitFor({ timeout: limit })
  })
}

async function scriptedAnswer(page: Page) {
  await page.goto(new URL('/ask', address).href)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click({ timeout: limit })
  await box.fill(QUESTION)
  return timed(async () => {
    await box.press('Enter')
    const main = page.getByRole('main')
    await main
      .getByText(/^Checked$/)
      .first()
      .waitFor({ timeout: limit })
    await main
      .getByText(/A new customs rule stopped all online sales to Norway/)
      .waitFor({ timeout: limit })
  })
}

const steps = {
  'First page': firstPage,
  'Context list': contextList,
  'Scripted answer': scriptedAnswer,
}
const times: Record<string, number[]> = Object.fromEntries(Object.keys(steps).map((k) => [k, []]))

const browser = await chromium.launch()
try {
  for (let round = 1; round <= rounds; round++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const line: string[] = []
    for (const [name, step] of Object.entries(steps)) {
      const ms = await step(page)
      times[name]!.push(ms)
      line.push(`${name.toLowerCase()} ${(ms / 1000).toFixed(2)} s`)
    }
    console.log(`round ${round}: ${line.join(', ')}`)
    await context.close()
  }
} finally {
  await browser.close()
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`
const median = (list: number[]) => {
  const sorted = [...list].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const table = [
  `| What | Median | Slowest | Each round |`,
  `| --- | --- | --- | --- |`,
  ...Object.entries(times).map(
    ([name, list]) =>
      `| ${name} | ${seconds(median(list))} | ${seconds(Math.max(...list))} | ${list.map(seconds).join(', ')} |`,
  ),
].join('\n')
console.log(`\n${table}`)
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### The demo in a browser, ${rounds} rounds\n\n${table}\n\n`,
  )
