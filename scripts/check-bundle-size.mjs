// Fails when the first load of the web app grows too much. `npm run size` builds the web app as it
// ships and runs this; `node scripts/check-bundle-size.mjs` checks the build already in dist/web.
// What counts: the scripts and styles that index.html loads or preloads (not lazy route chunks).
// The build that ships is the http one (VITE_API_MODE=http, as the Docker image builds it), so
// `npm run size` builds that, the same way locally and in CI.
//
// Two rules for the script, each reported with its numbers:
// 1. Growth: with `--base <dir>`, the built dist/web of the commit the change is checked against,
//    the change may add at most maxGrowthBytes of first load script over that base. CI builds the
//    base (the first parent of the commit under test, which is main for a pull request) on the same
//    runner, so both numbers come from the same gzip. A pull request that merges first moves the
//    base for the others, so they are not failed by its few bytes on their next run.
// 2. Ceiling: whatever the growth, the first load script may not pass ceilingKb.js. The ceiling
//    is a hard limit: it moves only on purpose, by the maintainer, in a pull request that says why,
//    never to let one change through. The pipeline's automatic repairs may not edit this file
//    (protected_paths in .no-mistakes.yaml).
// The CSS (one stylesheet for the whole app) has the ceiling only.
// Without --base (a local run, or CI on main and at night) only the ceilings apply.
// CI counts more than a Mac does for the same build: the files are byte for byte the same, but
// Node's gzip on CI's x86 runners gives 1.3 to 1.8 KB more than on Apple silicon. So read the
// numbers CI prints, not a local one.
// Script ceiling: 443 KB since 15 Nov 2026, when CI read 451934 bytes (441.3 KB) on main.
// CSS ceiling: 33 KB since 1 Nov 2026, when CI read 32683 bytes (31.9 KB) on main.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

const ceilingKb = { js: 443, css: 33 }
const maxGrowthBytes = 1024

const kb = (bytes) => (bytes / 1024).toFixed(1)

/** The gzip bytes of each script and style that `dir`/index.html loads, and their totals. */
function firstLoad(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(js|css))"/g)].map((match) => ({
    file: match[1],
    kind: match[2],
  }))
  if (assets.length === 0)
    throw new Error(
      `No assets found in ${join(dir, 'index.html')}. Run \`npm run size\` to build and check.`,
    )
  const totals = { js: 0, css: 0 }
  const files = assets.map(({ file, kind }) => {
    const bytes = gzipSync(readFileSync(join(dir, file))).length
    totals[kind] += bytes
    return { file, bytes }
  })
  return { totals, files }
}

// `node scripts/check-bundle-size.mjs [<dir>] [--base <dir>]`: <dir> is dist/web unless given.
const { values, positionals } = parseArgs({
  options: { base: { type: 'string' } },
  allowPositionals: true,
})
const root = positionals[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web')
const { totals, files } = firstLoad(root)
for (const { file, bytes } of files)
  console.log(`${String(bytes).padStart(7)} bytes ${kb(bytes).padStart(6)} KB gzip  ${file}`)

const rows = []
for (const kind of ['js', 'css']) {
  const bytes = totals[kind]
  const ceiling = ceilingKb[kind] * 1024
  const margin = ceiling - bytes
  rows.push({
    rule: `${kind === 'js' ? 'Script' : 'CSS'} ceiling`,
    ok: margin >= 0,
    line: `initial ${kind}: ${bytes} bytes (${kb(bytes)} KB) gzip, ceiling ${ceiling} bytes (${ceilingKb[kind]} KB), ${margin >= 0 ? `${margin} bytes to spare` : `${-margin} bytes over`}`,
    problem: `The ${kind === 'js' ? 'first load script' : 'first load CSS'} is ${bytes} bytes (${kb(bytes)} KB), ${-margin} bytes over its hard ceiling of ${ceiling} bytes (${ceilingKb[kind]} KB). The ceiling holds whatever the growth: lazy load code to come under it. Only the maintainer raises it, on purpose, in a pull request that says why.`,
  })
}
if (values.base) {
  const base = firstLoad(values.base).totals.js
  const growth = totals.js - base
  const margin = maxGrowthBytes - growth
  rows.splice(1, 0, {
    rule: 'Script growth',
    ok: margin >= 0,
    line: `js growth over the base: ${growth >= 0 ? '+' : ''}${growth} bytes (base ${base}, this build ${totals.js}), at most +${maxGrowthBytes} bytes, ${margin >= 0 ? `${margin} bytes to spare` : `${-margin} bytes over`}`,
    problem: `This change grows the first load script by ${growth} bytes, from ${base} bytes on its base to ${totals.js} bytes, more than the ${maxGrowthBytes} bytes one change may add. Lazy load the new code, so the first load stays as it is.`,
  })
}
for (const { ok, line } of rows) console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`)

// In CI the numbers go to the job's summary page too, so a pull request shows how close it is.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### First load (gzip)',
      '',
      '| Rule | Result |',
      '| --- | --- |',
      ...rows.map(({ rule, ok, line }) => `| ${rule} | ${ok ? line : `**FAIL** ${line}`} |`),
      '',
      '',
    ].join('\n'),
  )
}
const problems = rows.filter((row) => !row.ok)
if (problems.length > 0) {
  for (const { rule, problem } of problems) console.error(`${rule} rule failed: ${problem}`)
  process.exit(1)
}
